from fastapi import FastAPI, File, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import json
import os
import re
import time
from dotenv import load_dotenv
import httpx

load_dotenv()

app = FastAPI(title="Tree Visualizer API")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局状态
sessions: Dict[str, "ChatSession"] = {}
active_connections: Dict[str, WebSocket] = {}

# 会话持久化目录（每会话一个 JSON）
PERSIST_DIR = Path(
    os.getenv(
        "CHAT_DATA_DIR",
        str(Path(__file__).resolve().parent / "data" / "sessions"),
    )
).resolve()
STREAM_PERSIST_INTERVAL_SEC = float(
    (os.getenv("CHAT_STREAM_PERSIST_INTERVAL_SEC", "1.0") or "1.0").strip()
    or "1.0"
)

DATA_DIR = PERSIST_DIR.parent
PDF_DIR = (DATA_DIR / "pdfs").resolve()
LLM_CONFIG_PATH = Path(
    os.getenv("LLM_CONFIG_FILE", str(DATA_DIR / "llm_config.json"))
).resolve()

_ALLOWED_FILE_PROVIDERS = frozenset({"openai_compat", "anthropic"})


def _persist_path(session_key: str) -> Path:
    if ".." in session_key or "/" in session_key or "\\" in session_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid session key",
        )
    return PERSIST_DIR / f"{session_key}.json"


def session_to_payload(session: "ChatSession") -> Dict[str, Any]:
    return {
        "session_key": session.session_key,
        "updated_at": datetime.now().timestamp(),
        "root_nodes": list(session.root_nodes),
        "active_branches": list(session.active_branches),
        "pdf_stored_name": session.pdf_stored_name,
        "pdf_display_name": session.pdf_display_name,
        "nodes": {nid: node.model_dump() for nid, node in session.nodes.items()},
    }


def persist_session(session: "ChatSession") -> None:
    """将会话写入磁盘（覆盖同名文件）。"""
    try:
        PERSIST_DIR.mkdir(parents=True, exist_ok=True)
        path = _persist_path(session.session_key)
        payload = session_to_payload(session)
        path.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
    except HTTPException:
        raise
    except OSError as e:
        print(f"[WARN] persist_session failed: {e}", flush=True)


def session_from_payload(data: Dict[str, Any]) -> "ChatSession":
    s = ChatSession(data["session_key"])
    s.root_nodes = list(data.get("root_nodes", []))
    s.active_branches = set(data.get("active_branches", []))
    s.pdf_stored_name = data.get("pdf_stored_name")
    s.pdf_display_name = data.get("pdf_display_name")
    for nid, raw in data.get("nodes", {}).items():
        s.nodes[nid] = ChatNode(**raw)
    return s


def load_session_from_disk(session_key: str) -> Optional["ChatSession"]:
    try:
        path = _persist_path(session_key)
    except HTTPException:
        return None
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return session_from_payload(data)
    except Exception as e:
        print(f"[WARN] load_session_from_disk {session_key}: {e}", flush=True)
        return None

MAX_BRANCH_SUMMARY_NODES = int(os.getenv("MAX_BRANCH_SUMMARY_NODES", "200"))
DEFAULT_BRANCH_SUMMARY_SYSTEM = (
    "你是对话分支的摘要器。下方是按时间顺序的多轮对话实录：每轮两行，第一行为「[序号] user」或「[序号] assistant」（从 0 起），"
    "第二行为该轮正文；须按序号顺序通读全文后做**均衡式总结**，不能只放大最后一轮。"
    "【均衡约束（须同时满足）】"
    "（1）全文约 5～12 句，合并为一段连续中文；"
    "（2）**开篇 1～2 句**须交代：用户最初问什么、话题从哪起头（不得用回答最后一问作为全文开头）；"
    "（3）中间若干句按对话推进顺序，分别点到**每一轮用户问题的主题**及助手回应的要点，轮次越靠前越不可省略为一句带过；若某轮仅寒暄可一句略写，但不得整段只剩最后几轮；"
    "（4）**最后 1～2 句**再收束到当前分支的结论或最新进展，避免全文只写「用户最后一问」及其回答；"
    "（5）若多轮在讨论同一主题（如从介绍人物追问到结局），须写出「如何由浅入深」，而非只写结局段。"
    "【形式】禁止编号与分条（不要用 1.2.3.）、禁止小标题、禁止 Markdown（**、#、引用的 >、列表破折号），只输出一段散文。"
    "不要输出思考过程、XML/标签或旁白。若几乎无信息，只输出：无内容可总结。"
)

# 摘要前去掉模型思考块（如 redacted_thinking），否则长段内部推理会占满注意力，摘要易「只像最后一问」
_THINKING_PAIR = re.compile(
    r"<\s*(?:think|thinking|redacted_thinking|reasoning)\b[^>]*>[\s\S]*?"
    r"</\s*(?:think|thinking|redacted_thinking|reasoning)\s*>",
    re.IGNORECASE,
)


def strip_thinking_for_summary(text: str) -> str:
    """去掉 redacted_thinking / think 等成对标签块，仅保留对用户可见的正文。"""
    if not text or not text.strip():
        return text
    s = text
    for _ in range(6):
        t = _THINKING_PAIR.sub("", s)
        if t == s:
            break
        s = t
    s = re.sub(
        r"<\s*/?\s*redacted_thinking\s*/?>", "", s, flags=re.IGNORECASE
    )
    s = re.sub(r"<\s*/?\s*think(?:ing)?\s*/?>", "", s, flags=re.IGNORECASE)
    return s.strip()


def postprocess_branch_summary_output(text: str) -> str:
    """
    摘要后处理：去掉模型常违规输出的 Markdown/列表/标题，合并为单段，便于与系统提示一致。
    设 BRANCH_SUMMARY_NO_POSTPROCESS=1/true 可跳过（调试用）。
    """
    if not text or not text.strip():
        return text
    if (os.getenv("BRANCH_SUMMARY_NO_POSTPROCESS", "").strip() or "").lower() in (
        "1",
        "true",
        "yes",
    ):
        return text.strip()
    s = text
    s = s.replace("**", "").replace("__", "")
    s = re.sub(r"(?m)^#+\s*", "", s)
    s = re.sub(r"(?m)^>\s*", "", s)
    s = re.sub(r"(?m)^[\-\*]\s+", "", s)
    s = re.sub(r"(?m)^\d+\.\s+", "", s)
    lines = [ln.strip() for ln in s.splitlines() if ln.strip()]
    s = " ".join(lines)
    s = re.sub(r"[ \t\u3000]+", " ", s)
    s = s.strip()
    return s


def _branch_summary_temperature() -> float:
    """摘要任务略降温度，减少「像原文一样分条」的倾向；可用 BRANCH_SUMMARY_TEMPERATURE 覆盖。"""
    raw = (os.getenv("BRANCH_SUMMARY_TEMPERATURE", "0.35") or "").strip()
    return float(raw) if raw else 0.35


def format_branch_summary_indexed_transcript(
    role_messages: List[Dict[str, str]],
) -> str:
    """
    将多轮 user/assistant 压成纯文本（带序号与角色名），避免请求体里多条 message
    的 JSON 结构使部分 OpenAI 兼容接口过度关注末轮。
    """
    parts: List[str] = []
    for i, m in enumerate(role_messages):
        role = (m.get("role") or "").strip()
        content = (m.get("content") or "").strip()
        parts.append(f"[{i}] {role}")
        parts.append(content if content else "(空)")
        parts.append("")
    return "\n".join(parts).rstrip()


@dataclass
class LlmEnv:
    """LLM 环境配置（与 handle_chat_message 中解析逻辑一致）。"""
    llm_provider: str
    base_url: str
    model_name: str
    api_key: str
    proxy: Optional[str] = None


def _resolve_http_proxy() -> Optional[str]:
    http_proxy = os.getenv("HTTP_PROXY") or os.getenv("http_proxy")
    https_proxy = os.getenv("HTTPS_PROXY") or os.getenv("https_proxy")
    if http_proxy and http_proxy.strip():
        return http_proxy.strip()
    if https_proxy and https_proxy.strip():
        return https_proxy.strip()
    return None


def _mask_api_key(key: str) -> str:
    k = (key or "").strip()
    if len(k) <= 8:
        return "********" if k else ""
    return f"{k[:4]}…{k[-4:]}"


def _read_llm_config_disk() -> Optional[Dict[str, Any]]:
    if not LLM_CONFIG_PATH.is_file():
        return None
    try:
        data = json.loads(LLM_CONFIG_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception as e:
        print(f"[WARN] _read_llm_config_disk: {e}", flush=True)
        return None


def _write_llm_config_disk(payload: Dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = LLM_CONFIG_PATH
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _disk_llm_override() -> Optional[LlmEnv]:
    """若本机 llm_config.json 含有效 Key 与字段，则覆盖环境变量。"""
    data = _read_llm_config_disk()
    if not data:
        return None
    key = (data.get("api_key") or "").strip()
    prov = (data.get("llm_provider") or "").strip().lower()
    base = (data.get("base_url") or "").strip().rstrip("/")
    model = (data.get("model_name") or "").strip()
    if not key or prov not in _ALLOWED_FILE_PROVIDERS or not base or not model:
        return None
    return LlmEnv(
        llm_provider=prov,
        base_url=base,
        model_name=model,
        api_key=key,
        proxy=_resolve_http_proxy(),
    )


def _get_llm_env_from_env() -> LlmEnv:
    """仅从环境变量解析（历史行为）。"""
    openai_base = (os.getenv("OPENAI_BASE_URL") or "").strip()
    if openai_base:
        llm_provider = "openai_compat"
        base_url = openai_base.rstrip("/")
        default_model = "MiniMax-M2.5"
        model_name = os.getenv("MODEL_NAME") or default_model
        api_key = os.getenv("OPENAI_API_KEY") or os.getenv("API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY not configured (OPENAI_BASE_URL is set)")
    else:
        base_url = os.getenv("API_BASE_URL", "https://api.anthropic.com").rstrip("/")
        llm_provider = (os.getenv("LLM_PROVIDER") or "").strip().lower()
        if not llm_provider:
            if "minimax" in base_url.lower():
                llm_provider = "minimax"
            elif "openrouter" in base_url.lower():
                llm_provider = "openrouter"
            else:
                llm_provider = "anthropic"
        if llm_provider == "minimax":
            default_model = "M2-her"
        elif llm_provider == "openrouter":
            default_model = "claude-sonnet-4-5"
        else:
            default_model = "claude-sonnet-4.5-20250514"
        model_name = os.getenv("MODEL_NAME") or default_model
        if llm_provider == "minimax":
            api_key = os.getenv("MINIMAX_API_KEY") or os.getenv("API_KEY")
            if not api_key:
                raise ValueError("MINIMAX_API_KEY not configured")
        elif llm_provider == "openrouter":
            api_key = (
                os.getenv("OPENROUTER_API_KEY")
                or os.getenv("ANTHROPIC_API_KEY")
                or os.getenv("API_KEY")
            )
            if not api_key:
                raise ValueError("OPENROUTER_API_KEY or ANTHROPIC_API_KEY not configured")
        else:
            api_key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("API_KEY")
            if not api_key:
                raise ValueError("ANTHROPIC_API_KEY not configured")
    return LlmEnv(
        llm_provider=llm_provider,
        base_url=base_url,
        model_name=model_name,
        api_key=api_key,
        proxy=_resolve_http_proxy(),
    )


def get_llm_env() -> LlmEnv:
    """优先本机保存的 llm_config.json；无效或未配置 Key 时回退环境变量。"""
    override = _disk_llm_override()
    if override:
        return override
    return _get_llm_env_from_env()


def build_llm_headers(env: LlmEnv) -> Dict[str, str]:
    headers: Dict[str, str] = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {env.api_key}",
    }
    if env.llm_provider == "openrouter":
        headers["HTTP-Referer"] = "http://localhost:5173"
        headers["X-Title"] = "ChatTree Visualizer"
    if env.llm_provider == "anthropic":
        headers["anthropic-version"] = "2023-06-01"
    return headers


def get_httpx_client_kwargs(env: LlmEnv) -> Dict[str, Any]:
    kwargs: Dict[str, Any] = {"verify": False}
    if env.proxy:
        kwargs["proxy"] = env.proxy
    return kwargs


def build_stream_chat_params(
    env: LlmEnv, context: List[Dict[str, str]]
) -> Tuple[str, dict]:
    """流式聊天请求（与 /ws chat 中逻辑一致）。"""
    if env.llm_provider == "openai_compat":
        max_tok = int(os.getenv("MAX_TOKENS", "4096"))
        request_body = {
            "model": env.model_name,
            "messages": [{"role": m["role"], "content": m["content"]} for m in context],
            "max_tokens": max_tok,
            "stream": True,
        }
        return f"{env.base_url}/chat/completions", request_body
    if env.llm_provider == "minimax":
        max_ct = int(os.getenv("MAX_COMPLETION_TOKENS", "2048"))
        request_body = {
            "model": env.model_name,
            "messages": [{"role": m["role"], "content": m["content"]} for m in context],
            "stream": True,
            "max_completion_tokens": max_ct,
        }
        return f"{env.base_url}/v1/text/chatcompletion_v2", request_body
    if env.llm_provider == "openrouter":
        request_body = {
            "model": env.model_name,
            "messages": context,
            "max_tokens": 4096,
            "stream": True,
        }
        return f"{env.base_url}/v1/chat/completions", request_body
    # Anthropic：首条 system 用顶层 system 字段，避免与 Messages API 角色约束冲突
    system_text: Optional[str] = None
    rest_messages: List[Dict[str, str]] = []
    for m in context:
        if m.get("role") == "system" and not rest_messages and system_text is None:
            system_text = m.get("content") or ""
        else:
            rest_messages.append(
                {"role": m["role"], "content": m.get("content") or ""}
            )
    request_body: Dict[str, Any] = {
        "model": env.model_name,
        "messages": rest_messages,
        "max_tokens": 4096,
        "stream": True,
    }
    if system_text is not None and system_text != "":
        request_body["system"] = system_text
    return f"{env.base_url}/v1/messages", request_body


def build_non_stream_branch_summary_params(
    env: LlmEnv,
    role_messages: List[Dict[str, str]],
    system_text: str,
) -> Tuple[str, dict]:
    """分支摘要非流式请求。role_messages 仅含 user/assistant；发往 LLM 时合并为单条 user 纯文本实录。"""
    max_out = int(os.getenv("BRANCH_SUMMARY_MAX_TOKENS", "1024"))
    temp = _branch_summary_temperature()
    transcript = format_branch_summary_indexed_transcript(role_messages)
    transcript_msg = {"role": "user", "content": transcript}
    if env.llm_provider == "anthropic":
        request_body: Dict[str, Any] = {
            "model": env.model_name,
            "max_tokens": max_out,
            "stream": False,
            "system": system_text,
            "messages": [transcript_msg],
            "temperature": temp,
        }
        return f"{env.base_url}/v1/messages", request_body
    if env.llm_provider == "openai_compat":
        max_tok = int(os.getenv("MAX_TOKENS", "4096"))
        return (
            f"{env.base_url}/chat/completions",
            {
                "model": env.model_name,
                "messages": [
                    {"role": "system", "content": system_text},
                    transcript_msg,
                ],
                "max_tokens": min(max_out, max_tok),
                "stream": False,
                "temperature": temp,
            },
        )
    if env.llm_provider == "minimax":
        max_ct = int(os.getenv("MAX_COMPLETION_TOKENS", "2048"))
        return (
            f"{env.base_url}/v1/text/chatcompletion_v2",
            {
                "model": env.model_name,
                "messages": [
                    {"role": "system", "content": system_text},
                    transcript_msg,
                ],
                "stream": False,
                "max_completion_tokens": min(max_out, max_ct),
                "temperature": temp,
            },
        )
    if env.llm_provider == "openrouter":
        return (
            f"{env.base_url}/v1/chat/completions",
            {
                "model": env.model_name,
                "messages": [
                    {"role": "system", "content": system_text},
                    transcript_msg,
                ],
                "max_tokens": min(max_out, 4096),
                "stream": False,
                "temperature": temp,
            },
        )
    raise ValueError(f"Unknown llm_provider: {env.llm_provider}")


def parse_non_stream_response(env: LlmEnv, data: Dict[str, Any]) -> str:
    if env.llm_provider in ("openai_compat", "openrouter"):
        ch = data.get("choices", [])
        if ch:
            return (ch[0].get("message") or {}).get("content") or ""
        return ""
    if env.llm_provider == "minimax":
        ch = data.get("choices", [])
        if ch:
            t = (ch[0].get("message") or {}).get("content")
            if t:
                return t
        return str(data.get("reply", "") or data.get("text", "") or "")
    for block in data.get("content", []):
        if block.get("type") == "text" and "text" in block:
            return str(block["text"])
    if data.get("type") == "message" and data.get("content"):
        c = data.get("content", [])
        for block in c:
            if block.get("type") == "text" and "text" in block:
                return str(block["text"])
    return ""


async def run_llm_non_stream(
    env: LlmEnv, role_messages: List[Dict[str, str]], system_text: str
) -> str:
    headers = build_llm_headers(env)
    api_url, request_body = build_non_stream_branch_summary_params(
        env, role_messages, system_text
    )
    # 与上游实际一致：完整的 HTTP JSON body（含 system/messages、temperature 等）
    _log_body = (os.getenv("BRANCH_SUMMARY_LOG_LLM_BODY", "1") or "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )
    if _log_body:
        try:
            body_json = json.dumps(
                request_body, ensure_ascii=False, indent=2
            )
        except (TypeError, ValueError):
            body_json = repr(request_body)
        print(f"[DEBUG] branch_summary 发往 LLM: POST {api_url}", flush=True)
        print(
            f"[DEBUG] branch_summary 发往 LLM: request_body（完整消息体）=\n{body_json}",
            flush=True,
        )

    async with httpx.AsyncClient(**get_httpx_client_kwargs(env)) as client:
        r = await client.post(
            api_url, headers=headers, json=request_body, timeout=120.0
        )
        if r.status_code != 200:
            raise RuntimeError(
                f"LLM error {r.status_code}: {r.text[:2000]}"
            )
        return parse_non_stream_response(env, r.json()).strip()

# ============ 数据模型 ============

class MessageRole:
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"

class NodeStatus:
    PENDING = "pending"
    STREAMING = "streaming"
    COMPLETED = "completed"
    ABORTED = "aborted"

class ChatNode(BaseModel):
    id: str
    parent_id: Optional[str] = None
    role: str
    content: str
    children: List[str] = []
    branch_label: Optional[str] = None
    timestamp: float
    status: str = NodeStatus.PENDING
    # PDF / 章节目录
    node_kind: Optional[str] = None
    document_title: Optional[str] = None
    chapter_order: Optional[int] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    source_page: Optional[int] = None
    quote_excerpt: Optional[str] = None


class ChatSession:
    def __init__(self, session_key: str):
        self.session_key = session_key
        self.nodes: Dict[str, ChatNode] = {}
        self.root_nodes: List[str] = []
        self.active_branches: set = set()
        self.pdf_stored_name: Optional[str] = None
        self.pdf_display_name: Optional[str] = None

    def add_node(self, node: ChatNode):
        self.nodes[node.id] = node
        if node.parent_id:
            parent = self.nodes.get(node.parent_id)
            if parent and node.id not in parent.children:
                parent.children.append(node.id)
        else:
            if node.id not in self.root_nodes:
                self.root_nodes.append(node.id)

    def get_context_path(self, node_id: str) -> List[Dict[str, str]]:
        """构建从根到当前节点的上下文路径（原始链；流式前请用 normalize_context_for_stream）。"""
        path = []
        current_id = node_id

        while current_id:
            node = self.nodes.get(current_id)
            if not node:
                break
            path.insert(0, {"role": node.role, "content": node.content})
            current_id = node.parent_id

        return path


def get_node_path_to(session: ChatSession, node_id: str) -> List[ChatNode]:
    out: List[ChatNode] = []
    current_id: Optional[str] = node_id
    while current_id:
        n = session.nodes.get(current_id)
        if not n:
            break
        out.insert(0, n)
        current_id = n.parent_id
    return out


def normalize_context_for_stream(session: ChatSession, user_node_id: str) -> List[Dict[str, str]]:
    """合并文档/章节约束为单条 system，并拼接 user/assistant 轮；支持选区元数据。"""
    path = get_node_path_to(session, user_node_id)
    structural: List[ChatNode] = []
    turns: List[ChatNode] = []
    for n in path:
        nk = (n.node_kind or "").strip()
        if nk in ("doc_root", "chapter"):
            structural.append(n)
        elif n.role in (MessageRole.USER, MessageRole.ASSISTANT):
            turns.append(n)
    out: List[Dict[str, str]] = []
    if structural:
        parts: List[str] = []
        for n in structural:
            if n.node_kind == "doc_root":
                title = (n.document_title or n.content or "").strip() or "文档"
                parts.append(f"【阅读锚点-文档】{title}")
            elif n.node_kind == "chapter":
                pg = ""
                if n.page_start is not None:
                    if n.page_end is not None and n.page_end != n.page_start:
                        pg = f" 第{n.page_start}–{n.page_end}页"
                    else:
                        pg = f" 第{n.page_start}页"
                t = (n.content or "").strip() or "章节"
                parts.append(f"【阅读锚点-章节{pg}】{t}")
        out.append(
            {
                "role": MessageRole.SYSTEM,
                "content": "当前对话在以下阅读上下文中；请结合章节与摘录回答用户。\n" + "\n".join(parts),
            }
        )
    for n in turns:
        c = n.content or ""
        if n.role == MessageRole.USER and (n.quote_excerpt or "").strip():
            q = (n.quote_excerpt or "").strip()
            sp = n.source_page
            prefix = "【选区"
            if sp is not None:
                try:
                    prefix += f" 第{int(sp)}页"
                except (TypeError, ValueError):
                    pass
            prefix += f"】\n{q}\n\n"
            c = prefix + c
        out.append({"role": n.role, "content": c})
    return out


def _session_pdf_dir(session_key: str) -> Path:
    return (PDF_DIR / session_key).resolve()


def parse_pdf_chapters(pdf_path: Path) -> Tuple[str, List[Dict[str, Any]]]:
    """从 PDF 书签解析章节；无书签则单章「全文」。"""
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    n_pages = len(reader.pages)
    meta = reader.metadata
    title = ""
    if meta:
        title = (str(meta.get("/Title", "") or meta.get("/title", "") or "")).strip()
    if not title:
        title = pdf_path.stem
    flat: List[Tuple[str, int]] = []
    outline = getattr(reader, "outline", None) or []

    def dest_to_page_1based(dest: Any) -> int:
        try:
            n = int(reader.get_destination_page_number(dest))
            return max(1, n + 1)
        except Exception:
            return 1

    def walk(items: Any, _depth: int = 0) -> None:
        if not items:
            return
        for item in items:
            if isinstance(item, list):
                walk(item, _depth + 1)
            else:
                try:
                    p1 = dest_to_page_1based(item)
                    t = str(getattr(item, "title", None) or item).strip()
                    if t:
                        flat.append((t, p1))
                except Exception:
                    pass

    walk(outline)
    chapters: List[Dict[str, Any]] = []
    if flat:
        for i, (t, p) in enumerate(flat):
            p_end: int
            if i + 1 < len(flat):
                p_end = max(p, min(flat[i + 1][1] - 1, n_pages))
            else:
                p_end = n_pages
            p_end = max(p, min(p_end, n_pages))
            chapters.append(
                {
                    "title": t,
                    "page_start": p,
                    "page_end": p_end,
                    "order": i,
                }
            )
    else:
        chapters.append(
            {
                "title": "全文",
                "page_start": 1,
                "page_end": n_pages,
                "order": 0,
            }
        )
    return title, chapters


def build_document_chapter_tree(
    session: ChatSession, doc_title: str, chapters: List[Dict[str, Any]]
) -> None:
    session.nodes.clear()
    session.root_nodes.clear()
    ts = datetime.now().timestamp()
    doc_id = f"node_doc_{ts}"
    doc_node = ChatNode(
        id=doc_id,
        parent_id=None,
        role=MessageRole.SYSTEM,
        content=doc_title,
        node_kind="doc_root",
        document_title=doc_title,
        timestamp=ts,
        status=NodeStatus.COMPLETED,
    )
    session.add_node(doc_node)
    for ch in chapters:
        oid = ch["order"]
        cid = f"node_ch_{ts}_{oid}"
        cnode = ChatNode(
            id=cid,
            parent_id=doc_id,
            role=MessageRole.SYSTEM,
            content=ch["title"],
            node_kind="chapter",
            chapter_order=oid,
            page_start=ch.get("page_start"),
            page_end=ch.get("page_end"),
            timestamp=ts + 0.001 * (oid + 1),
            status=NodeStatus.COMPLETED,
        )
        session.add_node(cnode)
    persist_session(session)


def get_or_load_session(session_key: str) -> Optional[ChatSession]:
    s = sessions.get(session_key)
    if s:
        return s
    loaded = load_session_from_disk(session_key)
    if loaded:
        sessions[session_key] = loaded
        return loaded
    return None

# ============ API 端点 ============


class LlmConfigPublic(BaseModel):
    llm_provider: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None
    api_key_configured: bool = False
    api_key_hint: Optional[str] = None


class LlmConfigUpdate(BaseModel):
    clear_api_key: bool = False
    llm_provider: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None
    api_key: Optional[str] = None


def _public_from_disk() -> LlmConfigPublic:
    data = _read_llm_config_disk()
    if not data:
        return LlmConfigPublic()
    key = (data.get("api_key") or "").strip()
    has_key = bool(key)
    return LlmConfigPublic(
        llm_provider=data.get("llm_provider"),
        base_url=data.get("base_url"),
        model_name=data.get("model_name"),
        api_key_configured=has_key,
        api_key_hint=_mask_api_key(key) if has_key else None,
    )


@app.get("/api/llm-config", response_model=LlmConfigPublic)
async def get_llm_config():
    """返回本机保存的 LLM 配置（API Key 仅掩码）。"""
    return _public_from_disk()


@app.put("/api/llm-config", response_model=LlmConfigPublic)
async def put_llm_config(body: LlmConfigUpdate):
    """保存或清除本机 LLM 配置；保存时若未传新 api_key 则保留文件中已有 Key。"""
    if body.clear_api_key:
        if LLM_CONFIG_PATH.is_file():
            LLM_CONFIG_PATH.unlink()
        return _public_from_disk()
    if not body.llm_provider or not body.base_url or not body.model_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="llm_provider, base_url and model_name are required",
        )
    prov = body.llm_provider.strip().lower()
    if prov not in _ALLOWED_FILE_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="llm_provider must be openai_compat or anthropic",
        )
    base = body.base_url.strip().rstrip("/")
    model = body.model_name.strip()
    if not base or not model:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="base_url and model_name must be non-empty",
        )
    existing = _read_llm_config_disk() or {}
    api_key_final = (existing.get("api_key") or "").strip()
    if body.api_key is not None and body.api_key.strip():
        api_key_final = body.api_key.strip()
    if not api_key_final:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "API key is required; omit api_key to keep the existing key, "
                "or use clear_api_key to remove saved config and fall back to env"
            ),
        )
    _write_llm_config_disk(
        {
            "llm_provider": prov,
            "base_url": base,
            "model_name": model,
            "api_key": api_key_final,
        }
    )
    return _public_from_disk()


class CreateSessionRequest(BaseModel):
    session_key: Optional[str] = None

class CreateSessionResponse(BaseModel):
    session_key: str

@app.post("/api/sessions", response_model=CreateSessionResponse)
async def create_session(request: CreateSessionRequest):
    """创建新会话"""
    session_key = request.session_key or f"session_{datetime.now().timestamp()}"
    sessions[session_key] = ChatSession(session_key)
    persist_session(sessions[session_key])
    return CreateSessionResponse(session_key=session_key)

class GetSessionResponse(BaseModel):
    session_key: str
    nodes: Dict[str, ChatNode]
    root_nodes: List[str]
    has_pdf: bool = False
    pdf_display_name: Optional[str] = None

class SessionMeta(BaseModel):
    session_key: str
    updated_at: float
    node_count: int
    preview: str

class SessionListResponse(BaseModel):
    sessions: List[SessionMeta]

@app.get("/api/sessions", response_model=SessionListResponse)
async def list_saved_sessions():
    """列出已持久化的会话（按文件修改时间倒序）。"""
    PERSIST_DIR.mkdir(parents=True, exist_ok=True)
    items: List[SessionMeta] = []
    for path in sorted(
        PERSIST_DIR.glob("*.json"),
        key=lambda p: p.stat().st_mtime_ns,
        reverse=True,
    ):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            sk = str(data.get("session_key", path.stem))
            nodes = data.get("nodes", {})
            preview = ""
            node_count = len(nodes) if isinstance(nodes, dict) else 0
            if isinstance(nodes, dict):
                users = [
                    n
                    for n in nodes.values()
                    if isinstance(n, dict)
                    and n.get("role") == MessageRole.USER
                    and str(n.get("content") or "").strip()
                ]
                if users:
                    users.sort(key=lambda n: float(n.get("timestamp", 0)))
                    c = str(users[0].get("content") or "")
                    preview = c if len(c) <= 120 else c[:120] + "…"
            items.append(
                SessionMeta(
                    session_key=sk,
                    updated_at=float(
                        data.get("updated_at", path.stat().st_mtime)
                    ),
                    node_count=node_count,
                    preview=preview,
                )
            )
        except Exception:
            continue
    return SessionListResponse(sessions=items)

@app.get("/api/sessions/{session_key}", response_model=GetSessionResponse)
async def get_session(session_key: str):
    """获取会话数据（内存中无则从磁盘加载）。"""
    session = get_or_load_session(session_key)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return GetSessionResponse(
        session_key=session.session_key,
        nodes=session.nodes,
        root_nodes=session.root_nodes,
        has_pdf=bool(session.pdf_stored_name),
        pdf_display_name=session.pdf_display_name,
    )


@app.post("/api/sessions/{session_key}/pdf", response_model=GetSessionResponse)
async def upload_session_pdf(session_key: str, file: UploadFile = File(...)):
    """上传 PDF、解析书签为章节节点并持久化；仅允许尚无用户消息的会话。"""
    session = get_or_load_session(session_key)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if any(n.role == MessageRole.USER for n in session.nodes.values()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="会话中已有用户对话，请新建会话后再上传 PDF。",
        )
    fname = (file.filename or "").strip()
    if not fname.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅支持 .pdf 文件",
        )
    dest_dir = _session_pdf_dir(session_key)
    dest_dir.mkdir(parents=True, exist_ok=True)
    stored = "document.pdf"
    dest_path = dest_dir / stored
    raw = await file.read()
    if len(raw) > int(os.getenv("PDF_MAX_BYTES", str(50 * 1024 * 1024))):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="文件过大",
        )
    dest_path.write_bytes(raw)
    try:
        doc_title, chapters = parse_pdf_chapters(dest_path)
    except Exception as e:
        if dest_path.is_file():
            dest_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"无法解析 PDF: {e!s}",
        ) from e
    build_document_chapter_tree(session, doc_title, chapters)
    session.pdf_stored_name = stored
    session.pdf_display_name = fname
    persist_session(session)
    return GetSessionResponse(
        session_key=session.session_key,
        nodes=session.nodes,
        root_nodes=session.root_nodes,
        has_pdf=True,
        pdf_display_name=session.pdf_display_name,
    )


@app.get("/api/sessions/{session_key}/pdf")
async def download_session_pdf(session_key: str):
    """返回本会话上传的 PDF 文件。"""
    session = get_or_load_session(session_key)
    if not session or not session.pdf_stored_name:
        raise HTTPException(status_code=404, detail="PDF not found")
    path = _session_pdf_dir(session_key) / session.pdf_stored_name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="PDF file missing on disk")
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=session.pdf_display_name or "document.pdf",
    )

class CreateBranchRequest(BaseModel):
    session_key: str
    parent_node_id: Optional[str] = None
    message: str
    branch_label: Optional[str] = None

class CreateBranchResponse(BaseModel):
    node_id: str

@app.post("/api/branches", response_model=CreateBranchResponse)
async def create_branch(request: CreateBranchRequest):
    """创建分支（通过 WebSocket 处理实际的 LLM 调用）"""
    session = sessions.get(request.session_key)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # 创建用户消息节点
    node_id = f"node_{datetime.now().timestamp()}"
    user_node = ChatNode(
        id=node_id,
        parent_id=request.parent_node_id,
        role=MessageRole.USER,
        content=request.message,
        branch_label=request.branch_label,
        timestamp=datetime.now().timestamp(),
        status=NodeStatus.COMPLETED
    )

    session.add_node(user_node)
    persist_session(session)

    return CreateBranchResponse(node_id=node_id)


class BranchSummaryRequest(BaseModel):
    node_ids: List[str]


class BranchSummaryResponse(BaseModel):
    summary: str


@app.post(
    "/api/sessions/{session_key}/summary/branch",
    response_model=BranchSummaryResponse,
)
async def branch_summary(session_key: str, body: BranchSummaryRequest):
    """
    根据前端给定的、属于某可视列轨的节点 id 有序列表，组装对话并生成一段话摘要。
    服务端仅校验 id 均属于该 session，不在此按树做子树展开。
    """
    session = sessions.get(session_key)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not body.node_ids:
        raise HTTPException(
            status_code=400, detail="node_ids must not be empty"
        )
    if len(body.node_ids) > MAX_BRANCH_SUMMARY_NODES:
        raise HTTPException(
            status_code=400,
            detail=f"At most {MAX_BRANCH_SUMMARY_NODES} nodes allowed",
        )
    role_messages: List[Dict[str, str]] = []
    for nid in body.node_ids:
        node = session.nodes.get(nid)
        if not node:
            raise HTTPException(
                status_code=400, detail=f"Invalid node_id: {nid}"
            )
        if node.role not in (MessageRole.USER, MessageRole.ASSISTANT):
            continue
        raw = node.content or ""
        role_messages.append(
            {
                "role": node.role,
                "content": strip_thinking_for_summary(raw)
                if node.role == MessageRole.ASSISTANT
                else raw,
            }
        )
    if not role_messages:
        raise HTTPException(
            status_code=400, detail="No user/assistant content in node_ids"
        )
    # 终端校对：与送入 LLM 的 node_ids、逐条 message 一致，便于和前端 Network 对照
    _log_full = (os.getenv("BRANCH_SUMMARY_LOG_FULL", "").strip() or "").lower() in (
        "1",
        "true",
        "yes",
    )
    print(
        f"[DEBUG] branch_summary 校对: node_ids 共 {len(body.node_ids)} 个: {body.node_ids}",
        flush=True,
    )
    print(
        f"[DEBUG] branch_summary 校对: 送入 LLM 的 user/assistant 共 {len(role_messages)} 条",
        flush=True,
    )
    for i, m in enumerate(role_messages):
        c = m.get("content") or ""
        if _log_full:
            print(
                f"[DEBUG] branch_summary 校对: [{i}] role={m.get('role')} len={len(c)}",
                flush=True,
            )
            print(f"[DEBUG] branch_summary 校对:     content={c!r}", flush=True)
        else:
            prev = c if len(c) <= 500 else c[:500] + "…"
            print(
                f"[DEBUG] branch_summary 校对: [{i}] role={m.get('role')} "
                f"len={len(c)} content={prev!r}",
                flush=True,
            )

    system_text = os.getenv(
        "BRANCH_SUMMARY_SYSTEM", DEFAULT_BRANCH_SUMMARY_SYSTEM
    )
    try:
        env = get_llm_env()
    except ValueError as e:
        raise HTTPException(
            status_code=500, detail=str(e)
        ) from e
    try:
        text = await run_llm_non_stream(env, role_messages, system_text)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LLM request failed: {e!s}",
        ) from e
    text = strip_thinking_for_summary(text)
    text = postprocess_branch_summary_output(text)
    if not text:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Model returned an empty summary",
        )
    st = text if len(text) <= 300 else text[:300] + "…"
    print(
        f"[DEBUG] branch_summary 校对: 返回摘要 len={len(text)} preview={st!r}",
        flush=True,
    )
    return BranchSummaryResponse(summary=text)


# ============ WebSocket 端点 ============

@app.websocket("/ws/{session_key}")
async def websocket_endpoint(websocket: WebSocket, session_key: str):
    """WebSocket 连接处理"""
    await websocket.accept()
    active_connections[session_key] = websocket

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            if message["type"] == "chat":
                await handle_chat_message(websocket, session_key, message)
            elif message["type"] == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        active_connections.pop(session_key, None)
    except Exception as e:
        print(f"WebSocket error: {e}")
        active_connections.pop(session_key, None)

async def handle_chat_message(websocket: WebSocket, session_key: str, message: Dict[str, Any]):
    """处理聊天消息"""
    session = sessions.get(session_key)
    if not session:
        await websocket.send_json({"type": "error", "message": "Session not found"})
        return

    parent_node_id = message.get("parent_node_id")
    user_message = message.get("message")
    branch_label = message.get("branch_label")
    quote_excerpt = message.get("quote_excerpt")
    if quote_excerpt is not None:
        quote_excerpt = str(quote_excerpt).strip()[:8000] or None
    source_page_raw = message.get("source_page")
    source_page: Optional[int] = None
    if source_page_raw is not None:
        try:
            source_page = int(source_page_raw)
        except (TypeError, ValueError):
            source_page = None

    # 创建用户节点
    user_node_id = f"node_{datetime.now().timestamp()}"
    user_node = ChatNode(
        id=user_node_id,
        parent_id=parent_node_id,
        role=MessageRole.USER,
        content=user_message,
        branch_label=branch_label,
        timestamp=datetime.now().timestamp(),
        status=NodeStatus.COMPLETED,
        quote_excerpt=quote_excerpt,
        source_page=source_page,
    )
    session.add_node(user_node)
    persist_session(session)

    # 发送用户节点创建通知
    await websocket.send_json({
        "type": "node_created",
        "node": user_node.model_dump()
    })

    # 创建助手节点
    assistant_node_id = f"node_{datetime.now().timestamp() + 0.001}"
    assistant_node = ChatNode(
        id=assistant_node_id,
        parent_id=user_node_id,
        role=MessageRole.ASSISTANT,
        content="",
        timestamp=datetime.now().timestamp(),
        status=NodeStatus.STREAMING
    )
    session.add_node(assistant_node)
    persist_session(session)

    # 发送助手节点创建通知
    await websocket.send_json({
        "type": "node_created",
        "node": assistant_node.model_dump()
    })

    # 调用 API
    try:
        print(f"[DEBUG] Preparing API request...")

        env = get_llm_env()
        if env.proxy:
            print(f"[DEBUG] Using proxy: {env.proxy}")
        else:
            print(f"[DEBUG] No proxy configured")

        print(f"[DEBUG] API Base URL: {env.base_url}")
        print(f"[DEBUG] LLM provider: {env.llm_provider}")
        print(f"[DEBUG] Model: {env.model_name}")

        # 构建上下文（合并章节/选区为单条 system + 多轮 user/assistant）
        context = normalize_context_for_stream(session, user_node_id)
        print(f"[DEBUG] Context: {context}")

        headers = build_llm_headers(env)
        api_url, request_body = build_stream_chat_params(env, context)

        # OpenAI-style SSE: choices[].delta.content
        use_openai_delta_stream = env.llm_provider in (
            "openrouter",
            "minimax",
            "openai_compat",
        )
        client_kwargs = get_httpx_client_kwargs(env)

        # 流式调用
        full_content = ""
        last_stream_persist = 0.0
        print(f"[DEBUG] Starting stream...")

        async with httpx.AsyncClient(**client_kwargs) as client:
            print(f"[DEBUG] API URL: {api_url}")

            async with client.stream("POST", api_url, headers=headers, json=request_body, timeout=60.0) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    raise Exception(f"API error {response.status_code}: {error_text.decode()}")

                async for line in response.aiter_lines():
                    if not line.strip() or not line.startswith("data: "):
                        continue

                    data_str = line[6:]  # Remove "data: " prefix
                    if data_str == "[DONE]":
                        break

                    try:
                        data = json.loads(data_str)

                        if use_openai_delta_stream:
                            if "choices" in data and len(data["choices"]) > 0:
                                delta = data["choices"][0].get("delta", {})
                                text = delta.get("content", "") or ""
                                if text:
                                    full_content += text
                                    assistant_node.content = full_content
                                    await websocket.send_json({
                                        "type": "node_streaming",
                                        "node_id": assistant_node_id,
                                        "content": full_content
                                    })
                                    now_m = time.monotonic()
                                    if (
                                        now_m - last_stream_persist
                                        >= STREAM_PERSIST_INTERVAL_SEC
                                    ):
                                        persist_session(session)
                                        last_stream_persist = now_m
                        else:
                            # Anthropic 原生 Messages SSE
                            if data.get("type") == "content_block_delta":
                                text = data.get("delta", {}).get("text", "")
                                if text:
                                    full_content += text
                                    assistant_node.content = full_content
                                    await websocket.send_json({
                                        "type": "node_streaming",
                                        "node_id": assistant_node_id,
                                        "content": full_content
                                    })
                                    now_m = time.monotonic()
                                    if (
                                        now_m - last_stream_persist
                                        >= STREAM_PERSIST_INTERVAL_SEC
                                    ):
                                        persist_session(session)
                                        last_stream_persist = now_m
                    except json.JSONDecodeError:
                        continue

        # 完成
        print(f"[DEBUG] Stream completed. Full content length: {len(full_content)}")
        assistant_node.status = NodeStatus.COMPLETED
        persist_session(session)
        await websocket.send_json({
            "type": "node_completed",
            "node_id": assistant_node_id,
            "content": full_content
        })

    except Exception as e:
        print(f"[ERROR] Exception in handle_chat_message: {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
        assistant_node.status = NodeStatus.ABORTED
        assistant_node.content = f"Error: {str(e)}"
        persist_session(session)
        await websocket.send_json({
            "type": "node_error",
            "node_id": assistant_node_id,
            "error": str(e)
        })

@app.get("/")
async def root():
    return {"message": "Tree Visualizer API", "version": "0.1.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 8000)),
        reload=True
    )

