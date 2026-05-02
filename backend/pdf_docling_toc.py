"""
使用 Docling 标准 PDF 管道从版面模型提取章节（section_header），输出形状与 parse_pdf_chapters 一致。

约束（与项目配置一致）：
- 标准 StandardPdfPipeline / ThreadedPdfPipelineOptions
- accelerator_options.device = CPU
- 关闭 OCR、表格结构、公式/代码增强、页图/大图导出（减轻下载与内存）
- 不启用远程服务（默认 enable_remote_services=False）

环境变量（可选）：
- DOCLING_DEVICE=cpu（默认由代码设好）
- DOCLING_NUM_THREADS：由 AcceleratorOptions 读取
- TREE_DISABLE_DOCLING=1：跳过 Docling，仅在 infer 时回退到启发式
"""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from pdf_chapter_filters import is_likely_author_or_affiliation_line

_lock = threading.Lock()
_converter: Any = None
# Windows 上 PyTorch c10.dll 加载失败（WinError 1114）时置位，本进程内不再尝试 Docling。
_torch_dll_broken = threading.Event()
_torch_help_printed = threading.Lock()
_torch_help_done = False


def _is_torch_dll_failure(exc: BaseException) -> bool:
    msg = str(exc).lower()
    if getattr(exc, "winerror", None) == 1114:
        return True
    return any(
        s in msg
        for s in (
            "c10.dll",
            "1114",
            "dll load failed",
            "error loading",
            "dynamic link library",
        )
    )


def _mark_torch_broken_and_print_help(exc: BaseException) -> None:
    global _torch_help_done
    _torch_dll_broken.set()
    with _torch_help_printed:
        if _torch_help_done:
            return
        _torch_help_done = True
        print(
            "[docling/torch] PyTorch 无法加载（本进程已禁用 Docling）。\n"
            "  常见原因（与「是否装过 VC++」无必然关系）：\n"
            "  · 用了 Anaconda/miniconda 的 Python，与 pip 装的 torch DLL 冲突\n"
            "  · 应用未激活 backend\\venv，装包装到别的环境\n"
            "  · torch 轮子与当前 Python 位数/版本不匹配\n"
            "  建议在本项目 backend 目录、仅使用官方 Python 3.10+ 创建 venv 后执行：\n"
            "    pip uninstall torch torchvision -y\n"
            "    pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu\n"
            "  确认: where python 与 python -c \"import sys;print(sys.executable)\" 指向 ...\\\\backend\\\\venv\\\\...\n"
            "  若暂不需要 Docling：backend\\.env 中设 TREE_DISABLE_DOCLING=1\n"
            f"  原始错误: {exc!s}",
            flush=True,
        )


def _ensure_docling_cpu_env() -> None:
    os.environ.setdefault("DOCLING_DEVICE", "cpu")


def _get_converter():
    """懒加载单例，避免 import docling 阻塞未使用 Docling 的代码路径。"""
    global _converter
    with _lock:
        if _torch_dll_broken.is_set():
            raise OSError("PyTorch/DLL unavailable for Docling (see prior log)")
        if _converter is not None:
            return _converter
        _ensure_docling_cpu_env()
        try:
            from docling.datamodel.accelerator_options import (
                AcceleratorDevice,
                AcceleratorOptions,
            )
            from docling.datamodel.base_models import InputFormat
            from docling.datamodel.pipeline_options import ThreadedPdfPipelineOptions
            from docling.document_converter import DocumentConverter, PdfFormatOption

            pipeline_options = ThreadedPdfPipelineOptions(
                do_ocr=False,
                do_table_structure=False,
                do_code_enrichment=False,
                do_formula_enrichment=False,
                generate_page_images=False,
                generate_picture_images=False,
                generate_parsed_pages=False,
            )
            pipeline_options.accelerator_options = AcceleratorOptions(
                device=AcceleratorDevice.CPU,
            )

            _converter = DocumentConverter(
                allowed_formats=[InputFormat.PDF],
                format_options={
                    InputFormat.PDF: PdfFormatOption(
                        pipeline_options=pipeline_options,
                    ),
                },
            )
        except OSError as e:
            if _is_torch_dll_failure(e):
                _mark_torch_broken_and_print_help(e)
            raise
        return _converter


def warmup_docling() -> None:
    """
    在进程启动时调用：初始化 StandardPdf 管道并触发布局模型下载/加载，
    避免用户首次点击「智能解析」时才长时间等待。
    """
    if os.getenv("TREE_DISABLE_DOCLING", "").strip().lower() in (
        "1",
        "true",
        "yes",
    ):
        print("[docling] TREE_DISABLE_DOCLING set, skip warmup", flush=True)
        return

    if _torch_dll_broken.is_set():
        return

    try:
        from docling.datamodel.base_models import InputFormat

        conv = _get_converter()
        conv.initialize_pipeline(InputFormat.PDF)
    except OSError as e:
        if _is_torch_dll_failure(e):
            return
        raise

    print(
        "[docling] Standard PDF pipeline ready (CPU, no OCR / no table structure).",
        flush=True,
    )


def _normalize_page_1based(page_index_keys: List[int], p: int) -> int:
    """若 pages 的 key 含 0，则 prov.page_no 视为 0-based。"""
    if page_index_keys and min(page_index_keys) == 0:
        return max(1, p + 1)
    return max(1, p)


def infer_chapters_docling(pdf_path: Path) -> Optional[List[Dict[str, Any]]]:
    """
    从 Docling 的 section_header 生成章节列表。
    若禁用 Docling、转换失败或无足额章节，返回 None（由调用方回退启发式）。
    """
    if os.getenv("TREE_DISABLE_DOCLING", "").strip().lower() in (
        "1",
        "true",
        "yes",
    ):
        return None

    if _torch_dll_broken.is_set():
        return None

    path = Path(pdf_path)
    try:
        from docling.datamodel.base_models import ConversionStatus
        from docling_core.types.doc import SectionHeaderItem

        conv = _get_converter()
        result = conv.convert(str(path.resolve()))
    except OSError as e:
        if _torch_dll_broken.is_set() or _is_torch_dll_failure(e):
            return None
        raise

    if result.status == ConversionStatus.FAILURE:
        return None
    doc = result.document
    if doc is None:
        return None

    page_keys = sorted(doc.pages.keys()) if doc.pages else []
    if page_keys and min(page_keys) == 0:
        n_pages = max(page_keys) + 1
    else:
        n_pages = max(page_keys) if page_keys else 1

    raw_sections: List[Tuple[int, str]] = []
    for item, _lvl in doc.iterate_items():
        if not isinstance(item, SectionHeaderItem):
            continue
        title = (getattr(item, "text", None) or "").strip()
        if not title:
            continue
        if is_likely_author_or_affiliation_line(title):
            continue
        prov = getattr(item, "prov", None) or []
        if not prov:
            continue
        p = int(prov[0].page_no)
        raw_sections.append((_normalize_page_1based(page_keys, p), title))

    if len(raw_sections) < 2:
        return None

    candidates: List[Tuple[int, str]] = []
    prev: str | None = None
    for pno, t in raw_sections:
        if t == prev:
            continue
        if prev and (t in prev or prev in t) and len(t) < len(prev):
            candidates[-1] = (pno, t)
            prev = t
            continue
        if prev and (t in prev or prev in t):
            continue
        candidates.append((pno, t))
        prev = t

    if len(candidates) < 2:
        return None

    chapters: List[Dict[str, Any]] = []
    for i, (p_start, title) in enumerate(candidates):
        if i + 1 < len(candidates):
            p_end = max(p_start, min(candidates[i + 1][0] - 1, n_pages))
        else:
            p_end = n_pages
        p_end = max(p_start, min(p_end, n_pages))
        chapters.append(
            {
                "title": title[:200],
                "page_start": p_start,
                "page_end": p_end,
                "order": i,
            }
        )
    return chapters
