"""
本地启发式：从英文双栏论文等 PDF 推断章节（无 LLM）。依赖 PyMuPDF（fitz）。

统一规则（仅两类约束 + 一份词表，无零散过滤）：
  1) 词表 — 整行（不分大小写）等于常见节名，或整行「词表词 + 冒号」；
  2) 序标 + 标题尾 — 行首为固定罗马数字表，或「论文章节式」阿拉伯编号，
     且冒号后/序标后的标题必须以英文大写字母起头、长度合规。
     阿拉伯编号用一条文法描述：每段数字首位为 1–9（杜绝 0.06、前导零、四位年份）。
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

import fitz

TITLE_MAX_LEN = 120
FULL_WIDTH_FRAC = 0.48
CENTER_CROSS_FRAC = 0.05
BAND_PX = 12.0

# 常见节名（小写存储；匹配时对整行做规范化后再查）
KNOWN_SECTION_PHRASES = frozenset(
    {
        "abstract",
        "references",
        "acknowledgement",
        "acknowledgements",
        "acknowledgment",
        "acknowledgments",
        "introduction",
        "conclusion",
        "discussion",
        "appendix",
        "related work",
        "background",
        "methodology",
        "method",
        "methods",
        "experiments",
        "experimental setup",
        "evaluation",
        "results",
        "limitations",
        "future work",
        "broader impact",
        "overview",
        "preliminaries",
        "notation",
        "problem formulation",
        "theoretical analysis",
        "implementation details",
        "supplementary",
    }
)

# 罗马序标（与词表并列的一类「序标」，仅接受下列前缀）
_ROMAN_ORDER = (
    r"I|II|III|IV|V|VI|VII|VIII|IX|X|"
    r"XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX|"
    r"XXI|XXII|XXIII|XXIV|XXV"
)
_ROMAN_HEADING = re.compile(
    rf"^({_ROMAN_ORDER})\s*\.?\s*[—\-–]?\s+(.+)$",
    re.IGNORECASE,
)

# 阿拉伯序标：每段 1–99，最多三级，如 1 / 3.2 / 12.3.4；段首禁止 0（一条文法覆盖）
_ARABIC_HEADING = re.compile(
    r"^([1-9]\d{0,1}(?:\.[1-9]\d{0,1}){0,2})\.?\s+(.+)$",
)
_TITLE_TAIL_OK = re.compile(r"^[A-Z]")


def _normalize_line(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _heading_tail_ok(remainder: str) -> bool:
    """序标后的标题尾：长度合规，且以大写英文字母起头（与期刊常见节标题一致）。"""
    t = remainder.strip()
    if not (2 <= len(t) <= TITLE_MAX_LEN):
        return False
    return bool(_TITLE_TAIL_OK.match(t))


def _line_is_chapter_heading(text: str) -> bool:
    t = _normalize_line(text)
    if len(t) < 2 or len(t) > TITLE_MAX_LEN:
        return False

    key = t.lower()
    if key in KNOWN_SECTION_PHRASES:
        return True
    if t.endswith(":"):
        if key[:-1].rstrip() in KNOWN_SECTION_PHRASES:
            return True

    m = _ROMAN_HEADING.match(t)
    if m and _heading_tail_ok(m.group(2)):
        return True

    m = _ARABIC_HEADING.match(t)
    if m and _heading_tail_ok(m.group(2)):
        return True

    return False


def _normalize_chapter_title(text: str) -> str:
    return _normalize_line(text)[:200]


def _collect_page_lines(page: fitz.Page) -> List[Dict[str, Any]]:
    """按双栏近似阅读顺序排序的行列表。"""
    pw = float(page.rect.width)
    mid = pw / 2.0
    rows: List[Dict[str, Any]] = []
    d = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
    for block in d.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans") or []
            if not spans:
                continue
            parts = [s.get("text") or "" for s in spans]
            text = "".join(parts).strip()
            if not text:
                continue
            x0, y0, x1, y1 = (float(x) for x in line["bbox"])
            line_w = x1 - x0
            cx = (x0 + x1) / 2.0
            crosses = x0 < mid and x1 > mid + CENTER_CROSS_FRAC * pw
            fullwidth = line_w > FULL_WIDTH_FRAC * pw or crosses
            if fullwidth:
                col = 0
            elif cx < mid:
                col = 1
            else:
                col = 2
            rows.append({"text": text, "y0": y0, "x0": x0, "col": col})
    rows.sort(key=lambda r: (round(r["y0"] / BAND_PX), r["col"], r["x0"]))
    return rows


def infer_chapters_heuristic(pdf_path: Path) -> List[Dict[str, Any]]:
    """
    返回与 parse_pdf_chapters 相同形状的 chapter 列表。
    若无法得到至少 2 个可用章节，返回单章「全文」。
    """
    doc = fitz.open(pdf_path)
    try:
        n_pages = doc.page_count
        if n_pages < 1:
            return [
                {
                    "title": "全文",
                    "page_start": 1,
                    "page_end": 1,
                    "order": 0,
                }
            ]

        all_rows: List[Tuple[int, Dict[str, Any]]] = []
        for pno in range(n_pages):
            page = doc.load_page(pno)
            for ln in _collect_page_lines(page):
                all_rows.append((pno + 1, ln))

        candidates: List[Tuple[int, str]] = []
        prev_title: str | None = None
        for pno, row in all_rows:
            text = row["text"]
            if not _line_is_chapter_heading(text):
                continue
            t = _normalize_chapter_title(text)
            if not t or t == prev_title:
                continue
            if prev_title and (t in prev_title or prev_title in t):
                if len(t) < len(prev_title):
                    candidates[-1] = (pno, t)
                    prev_title = t
                continue
            candidates.append((pno, t))
            prev_title = t

        if len(candidates) < 2:
            return [
                {
                    "title": "全文",
                    "page_start": 1,
                    "page_end": n_pages,
                    "order": 0,
                }
            ]

        chapters: List[Dict[str, Any]] = []
        for i, (p_start, title) in enumerate(candidates):
            if i + 1 < len(candidates):
                p_end = max(p_start, min(candidates[i + 1][0] - 1, n_pages))
            else:
                p_end = n_pages
            p_end = max(p_start, min(p_end, n_pages))
            chapters.append(
                {
                    "title": title,
                    "page_start": p_start,
                    "page_end": p_end,
                    "order": i,
                }
            )
        return chapters
    finally:
        doc.close()


def read_pdf_metadata_title(pdf_path: Path, fallback_stem: str) -> str:
    try:
        doc = fitz.open(pdf_path)
        try:
            meta = doc.metadata or {}
            t = (meta.get("title") or "").strip()
            return t or fallback_stem
        finally:
            doc.close()
    except Exception:
        return fallback_stem
