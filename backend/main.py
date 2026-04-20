from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
import asyncio
import json
import os
from dotenv import load_dotenv
import anthropic
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

class ChatSession:
    def __init__(self, session_key: str):
        self.session_key = session_key
        self.nodes: Dict[str, ChatNode] = {}
        self.root_nodes: List[str] = []
        self.active_branches: set = set()

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
        """构建从根到当前节点的上下文路径"""
        path = []
        current_id = node_id

        while current_id:
            node = self.nodes.get(current_id)
            if not node:
                break
            path.insert(0, {"role": node.role, "content": node.content})
            current_id = node.parent_id

        return path

# ============ API 端点 ============

class CreateSessionRequest(BaseModel):
    session_key: Optional[str] = None

class CreateSessionResponse(BaseModel):
    session_key: str

@app.post("/api/sessions", response_model=CreateSessionResponse)
async def create_session(request: CreateSessionRequest):
    """创建新会话"""
    session_key = request.session_key or f"session_{datetime.now().timestamp()}"
    sessions[session_key] = ChatSession(session_key)
    return CreateSessionResponse(session_key=session_key)

class GetSessionResponse(BaseModel):
    session_key: str
    nodes: Dict[str, ChatNode]
    root_nodes: List[str]

@app.get("/api/sessions/{session_key}", response_model=GetSessionResponse)
async def get_session(session_key: str):
    """获取会话数据"""
    session = sessions.get(session_key)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return GetSessionResponse(
        session_key=session.session_key,
        nodes=session.nodes,
        root_nodes=session.root_nodes
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

    return CreateBranchResponse(node_id=node_id)

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

    # 创建用户节点
    user_node_id = f"node_{datetime.now().timestamp()}"
    user_node = ChatNode(
        id=user_node_id,
        parent_id=parent_node_id,
        role=MessageRole.USER,
        content=user_message,
        branch_label=branch_label,
        timestamp=datetime.now().timestamp(),
        status=NodeStatus.COMPLETED
    )
    session.add_node(user_node)

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

    # 发送助手节点创建通知
    await websocket.send_json({
        "type": "node_created",
        "node": assistant_node.model_dump()
    })

    # 调用 API
    try:
        print(f"[DEBUG] Preparing API request...")

        # 配置代理
        http_proxy = os.getenv("HTTP_PROXY") or os.getenv("http_proxy")
        https_proxy = os.getenv("HTTPS_PROXY") or os.getenv("https_proxy")

        # 过滤空字符串和空白字符串
        proxy = None
        if http_proxy and http_proxy.strip():
            proxy = http_proxy.strip()
        elif https_proxy and https_proxy.strip():
            proxy = https_proxy.strip()

        if proxy:
            print(f"[DEBUG] Using proxy: {proxy}")
        else:
            print(f"[DEBUG] No proxy configured")

        # 获取 API 配置（OPENAI_BASE_URL 优先：MiniMax 等 OpenAI 兼容网关）
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

        print(f"[DEBUG] API Base URL: {base_url}")
        print(f"[DEBUG] LLM provider: {llm_provider}")
        print(f"[DEBUG] Model: {model_name}")

        # 构建上下文
        context = session.get_context_path(user_node_id)
        print(f"[DEBUG] Context: {context}")

        # 准备请求
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }

        if llm_provider == "openrouter":
            headers["HTTP-Referer"] = "http://localhost:5173"
            headers["X-Title"] = "ChatTree Visualizer"

        # 构建请求体与 URL
        if llm_provider == "openai_compat":
            max_tok = int(os.getenv("MAX_TOKENS", "4096"))
            request_body = {
                "model": model_name,
                "messages": [{"role": m["role"], "content": m["content"]} for m in context],
                "max_tokens": max_tok,
                "stream": True,
            }
            api_url = f"{base_url}/chat/completions"
        elif llm_provider == "minimax":
            max_ct = int(os.getenv("MAX_COMPLETION_TOKENS", "2048"))
            request_body = {
                "model": model_name,
                "messages": [{"role": m["role"], "content": m["content"]} for m in context],
                "stream": True,
                "max_completion_tokens": max_ct,
            }
            api_url = f"{base_url}/v1/text/chatcompletion_v2"
        elif llm_provider == "openrouter":
            request_body = {
                "model": model_name,
                "messages": context,
                "max_tokens": 4096,
                "stream": True,
            }
            api_url = f"{base_url}/v1/chat/completions"
        else:
            request_body = {
                "model": model_name,
                "messages": context,
                "max_tokens": 4096,
                "stream": True,
            }
            api_url = f"{base_url}/v1/messages"

        # OpenAI-style SSE: choices[].delta.content
        use_openai_delta_stream = llm_provider in ("openrouter", "minimax", "openai_compat")

        # 创建 httpx client
        client_kwargs = {"verify": False}
        if proxy:
            client_kwargs["proxy"] = proxy

        # 流式调用
        full_content = ""
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
                    except json.JSONDecodeError:
                        continue

        # 完成
        print(f"[DEBUG] Stream completed. Full content length: {len(full_content)}")
        assistant_node.status = NodeStatus.COMPLETED
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

