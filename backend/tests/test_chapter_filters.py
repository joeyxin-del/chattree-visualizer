"""pdf_chapter_filters 单元测试。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from pdf_chapter_filters import is_likely_author_or_affiliation_line


class TestChapterAuthorFilters(unittest.TestCase):
    def test_university_and_name(self):
        self.assertTrue(
            is_likely_author_or_affiliation_line(
                "Vinay P. Namboodiri University of Bath"
            )
        )

    def test_tech_company(self):
        self.assertTrue(
            is_likely_author_or_affiliation_line("Jane Doe, OpenAI, San Francisco")
        )
        self.assertTrue(
            is_likely_author_or_affiliation_line("Authors: Bob · Google Research")
        )

    def test_no_false_positive_google_compound(self):
        self.assertFalse(
            is_likely_author_or_affiliation_line(
                "Google-Based Methods for Information Retrieval"
            )
        )

    def test_keeps_numbered_headings(self):
        self.assertFalse(is_likely_author_or_affiliation_line("1 Introduction"))
        self.assertFalse(is_likely_author_or_affiliation_line("III Related Work"))

    def test_email_orcid(self):
        self.assertTrue(
            is_likely_author_or_affiliation_line("Contact: a.b@institute.edu")
        )
        self.assertTrue(
            is_likely_author_or_affiliation_line("ORCID 0000-0002-1825-0097")
        )

    def test_middle_initial_name_only(self):
        self.assertTrue(
            is_likely_author_or_affiliation_line("Vinay P. Namboodiri")
        )


if __name__ == "__main__":
    unittest.main()
