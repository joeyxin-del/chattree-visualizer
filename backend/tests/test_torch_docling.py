"""
PyTorch 与 Docling 可用性检查（在 backend venv 下运行）。

- 若出现 WinError 1114 / c10.dll 等，Torch 相关用例自动 skip，并明确原因。
- 设置 TREE_DISABLE_DOCLING=1 时，跳过需要 Docling 管道的用例。
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def _torch_import_ok() -> bool:
    try:
        import torch

        x = torch.randn(2, 3)
        _ = x @ x.T
        return True
    except OSError:
        return False


def _docling_env_enabled() -> bool:
    return os.getenv("TREE_DISABLE_DOCLING", "").strip().lower() not in (
        "1",
        "true",
        "yes",
    )


def _reset_docling_module_state() -> None:
    import pdf_docling_toc as m

    m._torch_dll_broken.clear()
    with m._lock:
        m._converter = None


@unittest.skipUnless(_torch_import_ok(), "PyTorch 无法加载（例如 c10.dll / WinError 1114）")
class TestTorchSmoke(unittest.TestCase):
    def test_version_and_matmul(self):
        import torch

        self.assertTrue(bool(torch.__version__))
        x = torch.randn(4, 4)
        self.assertTupleEqual(tuple((x @ x.T).shape), (4, 4))


class TestDoclingWhenDisabled(unittest.TestCase):
    @patch.dict(os.environ, {"TREE_DISABLE_DOCLING": "1"}, clear=False)
    def test_infer_returns_none(self):
        import pdf_docling_toc as m

        self.assertIsNone(m.infer_chapters_docling(Path("/nonexistent/for_infer.pdf")))


@unittest.skipUnless(_torch_import_ok(), "PyTorch 无法加载")
@unittest.skipUnless(_docling_env_enabled(), "已设置 TREE_DISABLE_DOCLING")
class TestDoclingPipeline(unittest.TestCase):
    def setUp(self) -> None:
        _reset_docling_module_state()

    def test_package_import(self):
        import docling  # noqa: F401

    def test_get_converter_singleton(self):
        import pdf_docling_toc as m

        c1 = m._get_converter()
        c2 = m._get_converter()
        self.assertIs(c1, c2)

    def test_warmup_does_not_raise(self):
        import pdf_docling_toc as m

        _reset_docling_module_state()
        m.warmup_docling()


if __name__ == "__main__":
    unittest.main()
