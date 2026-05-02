"""
过滤易被误识别为「章节标题」的作者行、单位行、科技公司署名行。

- 机构 / 联系方式 / 链接：强信号；
- 主流科技公司英文名（词表）：强信号，按长短排序后做整词 / 整短语匹配；
- 西式「名 + 中间名缩写 + 姓」：补充信号（无数字、长度受限），减少对普通标题的误杀。
"""
from __future__ import annotations

import re
from functools import lru_cache

# ---------------------------------------------------------------------------
# 科技公司 / 品牌（英文常见写法；含部分消费品牌与云/AI 厂商；长短语在前以便 alternation 优先匹配长项）
# ---------------------------------------------------------------------------
_TECH_COMPANY_PHRASES: tuple[str, ...] = (
    "Activision Blizzard",
    "Alibaba Group",
    "Amazon Web Services",
    "Ant Group",
    "Applied Materials",
    "ByteDance",
    "Electronic Arts",
    "Epic Games",
    "Google Cloud",
    "Google Research",
    "Hewlett Packard",
    "Hewlett-Packard",
    "Hugging Face",
    "JD.com",
    "Lam Research",
    "LG Electronics",
    "Meta Platforms",
    "Microsoft Research",
    "Mistral AI",
    "MongoDB",
    "Northrop Grumman",
    "Palo Alto Networks",
    "Samsung Electronics",
    "Schneider Electric",
    "SoftBank Group",
    "Square Enix",
    "Stability AI",
    "Texas Instruments",
    "United Technologies",
    "Accenture",
    "Adobe",
    "Airbnb",
    "Akamai",
    "Alibaba",
    "Alphabet",
    "Amazon",
    "AMD",
    "Apple",
    "ARM",
    "Asana",
    "ASML",
    "Atlassian",
    "Autodesk",
    "AWS",
    "Baidu",
    "Block",
    "Bosch",
    "Broadcom",
    "Canonical",
    "Check Point",
    "CheckPoint",
    "Cisco",
    "Citrix",
    "Cloudflare",
    "Cohere",
    "Coinbase",
    "CrowdStrike",
    "Databricks",
    "Datadog",
    "DeepMind",
    "Dell",
    "DiDi",
    "DoorDash",
    "Dropbox",
    "eBay",
    "Elastic",
    "Ericsson",
    "Fortinet",
    "GCP",
    "GitHub",
    "GitLab",
    "Google",
    "HPE",
    "HP",
    "Huawei",
    "HuggingFace",
    "IBM",
    "Intel",
    "Instacart",
    "JD",
    "KLA",
    "Lenovo",
    "LG",
    "LinkedIn",
    "Lyft",
    "Marvell",
    "McAfee",
    "Meituan",
    "Meta",
    "Micron",
    "Midjourney",
    "Mozilla",
    "NetApp",
    "NetEase",
    "Netflix",
    "Nintendo",
    "Nokia",
    "Nutanix",
    "NVIDIA",
    "Okta",
    "OnePlus",
    "OpenAI",
    "OPPO",
    "Oracle",
    "Palantir",
    "Panasonic",
    "PayPal",
    "Pinduoduo",
    "Pinterest",
    "Qualcomm",
    "Qualtrics",
    "Red Hat",
    "RedHat",
    "Reddit",
    "Robinhood",
    "Roblox",
    "Salesforce",
    "Samsung",
    "SAP",
    "ServiceNow",
    "Shopify",
    "Siemens",
    "Slack",
    "Snap",
    "Snowflake",
    "Sony",
    "Splunk",
    "Spotify",
    "Square",
    "Stripe",
    "Symantec",
    "Tencent",
    "TikTok",
    "Toshiba",
    "TSMC",
    "Twitter",
    "Uber",
    "Ubisoft",
    "Unity",
    "Veritas",
    "VMware",
    "Vodafone",
    "Vonage",
    "vivo",
    "Waymo",
    "Workday",
    "Xiaomi",
    "Yahoo",
    "Zscaler",
    "Zoom",
    "3M",
)

# 去重并保持长短语优先（用于构建 alternation）
_seen: set[str] = set()
_TECH_ORDERED: list[str] = []
for _p in sorted(set(_TECH_COMPANY_PHRASES), key=len, reverse=True):
    _k = _p.casefold()
    if _k not in _seen:
        _seen.add(_k)
        _TECH_ORDERED.append(_p)


def _phrase_regex_part(phrase: str) -> str:
    parts = phrase.split()
    return r"\s+".join(re.escape(p) for p in parts)


def _bounded_company_match(phrase: str) -> str:
    """避免匹配 Google-Based、Meta-learning 等复合词内部的片段。"""
    core = _phrase_regex_part(phrase)
    return rf"(?<![\w\-]){core}(?![\w\-])"


@lru_cache(maxsize=1)
def _tech_company_pattern() -> re.Pattern[str]:
    inner = "|".join(_bounded_company_match(p) for p in _TECH_ORDERED)
    return re.compile(rf"(?:{inner})", re.IGNORECASE)


# 单位、联系方式、链接
_AFFILIATION_OR_CONTACT = re.compile(
    r"(?i)\b("
    r"university|univ\.?|college|polytechnic|"
    r"institute|inst\.?|academy|"
    r"laboratory|labs?\.?|"
    r"ltd\.?|inc\.?|corp\.?|corporation|company|co\.?|plc|gmbh|ag\b|s\.r\.l\.?|bv\b|nv\b|pty\b|limited|"
    r"department|dept\.?|school\s+of|faculty\s+of|"
    r"research\s+(center|centre|group)|center|centre|foundation|consortium|"
    r"hospital|clinic|ministry|"
    r"account\b|and\s+others?\b|\bet\s+al\.?|"
    r"orcid|doi:\s*|arxiv:|\barxiv\b|abs/|"
    r"https?://|\bwww\.|"
    r"[a-z0-9._%+-]+@[a-z0-9.\-]+\.[a-z]{2,}"
    r")\b"
)

_EDU_OR_ORG_TLD = re.compile(r"(?i)(\.edu\b|\.ac\.[a-z]{2}\b|\.gov\b)")

# 西式署名：首词为全拼名，含一至两段「X.」中间名，再接姓氏
_NAME_WITH_MIDDLE_INITIALS = re.compile(
    r"^[A-Z][a-z]{1,24}"
    r"(?:\s+[A-Z]\.){1,2}"
    r"\s+[A-Z][a-z]{1,24}"
    r"(?:\s+[A-Z][a-z]{1,24}){0,2}"
    r"\s*$"
)


def is_likely_author_or_affiliation_line(title: str) -> bool:
    """
    若文本更像作者 / 单位 / 科技公司署名而非章节标题，返回 True（调用方应丢弃该候选）。
    """
    t = (title or "").strip()
    if not t:
        return True
    if _AFFILIATION_OR_CONTACT.search(t):
        return True
    if _EDU_OR_ORG_TLD.search(t):
        return True
    if _tech_company_pattern().search(t):
        return True
    if re.search(r"\d", t):
        return False
    if len(t) > 120:
        return False
    if _NAME_WITH_MIDDLE_INITIALS.match(t):
        return True
    return False
