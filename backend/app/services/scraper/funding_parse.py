# backend/app/services/scraper/funding_parse.py
from __future__ import annotations

import os
import re
import json
import logging
from dataclasses import dataclass
from typing import Optional
from dotenv import load_dotenv
load_dotenv()

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# LLM config (enabled by default)
# -----------------------------------------------------------------------------
USE_FUNDING_LLM = str(os.getenv("FUNDING_PARSE_WITH_LLM", "1")).lower() in {"1", "true", "yes", "on"}
FUNDING_LLM_MODEL = os.getenv("FUNDING_PARSE_MODEL", "gpt-4.1-mini")
FUNDING_LLM_TIMEOUT = float(os.getenv("FUNDING_PARSE_LLM_TIMEOUT", "9.0"))  # seconds
DEFAULT_LLM_BUDGET = int(os.getenv("FUNDING_PARSE_LLM_BUDGET", "20"))       # calls per request

try:
    from openai import OpenAI  # pip install openai>=1.30.0
    _openai_available = True
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore
    _openai_available = False

_openai_client = None
if USE_FUNDING_LLM and _openai_available and os.getenv("OPENAI_API_KEY"):
    try:
        _openai_client = OpenAI()
    except Exception:  # pragma: no cover
        _openai_client = None
        USE_FUNDING_LLM = False

# -----------------------------------------------------------------------------
# Dataclass
# -----------------------------------------------------------------------------
@dataclass
class FundingParse:
    company: Optional[str] = None
    amount: Optional[str] = None
    round: Optional[str] = None
    investors: Optional[str] = None

# -----------------------------------------------------------------------------
# Per-request stats & budget (simple module-level counters)
# -----------------------------------------------------------------------------
_parse_stats = {
    "llm_calls": 0,
    "llm_success": 0,
    "llm_patched": 0,
    "rules_calls": 0,
    "roundups_skipped": 0,
}
_llm_budget_remaining = DEFAULT_LLM_BUDGET


def begin_funding_parse_request(*, budget: Optional[int] = None) -> None:
    """
    Call this at the start of each API request to reset counters + set an LLM budget.
    """
    global _parse_stats, _llm_budget_remaining
    _parse_stats = {
        "llm_calls": 0,
        "llm_success": 0,
        "llm_patched": 0,
        "rules_calls": 0,
        "roundups_skipped": 0,
    }
    _llm_budget_remaining = int(budget if budget is not None else DEFAULT_LLM_BUDGET)


def get_funding_parse_stats(*, reset: bool = False) -> dict:
    """
    Read (and optionally reset) per-request stats.
    """
    global _parse_stats
    out = dict(_parse_stats)
    if reset:
        begin_funding_parse_request(budget=_llm_budget_remaining)
    return out

# --------------------------------
# Round keywords (used in fallback)
# --------------------------------
_VERBS = r"(?:raises|raised|raise|secures|secured|bags|snags|lands|gets|obtains|picks up|closes|rakes in|snaps up|receives|garner[s]?|attracts|mops up)"
_ROUND_WORDS = (
    r"(?:pre[-\s]?seed|seed|angel|friends\s*&\s*family|pre[-\s]?series\s*[A-K]|series\s*[A-K]|bridge|growth|late[-\s]?stage|"
    r"venture\s*debt|debt|convertible\s*note|mezzanine|strategic(?:\s*investment)?|follow[-\s]?on|extension)"
)
_descriptor_leads = r"(?:Bengaluru|Delhi|Gurugram|Gurgaon|Mumbai|Pune|Hyderabad|Chennai|Noida|Kolkata|India|US|UK|Singapore|Dubai|European|American|Indian|US-based|UK-based|India-based|Singapore-based|Bengaluru-based|Delhi-based|Mumbai-based|Hyderabad-based|Chennai-based|Gurgaon-based|Noida-based|Pune-based)\b"

# -----------------------------------------------------------------------------
# Public entry point
# -----------------------------------------------------------------------------
def parse_funding_text(title: str, summary: str = "") -> FundingParse:
    """
    LLM-first funding parser. Falls back to rules if LLM is unavailable/fails.
    Logs which path is used: LLM or rules (and whether rules patched missing fields).
    Returns FundingParse(company, amount, round, investors).
    """
    global _parse_stats, _llm_budget_remaining

    # Quick skip: roundups / digests
    if _looks_like_roundup(title) or _looks_like_roundup(summary):
        _parse_stats["roundups_skipped"] += 1
        logger.info("funding_parse: used=skip_roundup reason=roundup_detected")
        return FundingParse(company=None, amount=None, round=None, investors=None)

    t = _norm(title)
    s = _norm(summary)

    used = None
    patched_fields: list[str] = []

    # --- Try LLM first (respect budget) ---
    parsed = None
    llm_reason = None
    used_llm = False
    if USE_FUNDING_LLM and _openai_client and _llm_budget_remaining > 0:
        _llm_budget_remaining -= 1
        _parse_stats["llm_calls"] += 1
        parsed = _parse_with_llm(t, s)
        used_llm = parsed is not None
        if used_llm:
            _parse_stats["llm_success"] += 1
            used = "llm"
        else:
            llm_reason = "llm_failed_or_invalid_response"
    else:
        llm_reason = (
            "budget_exhausted" if USE_FUNDING_LLM and _openai_client and _llm_budget_remaining <= 0
            else ("llm_disabled" if not USE_FUNDING_LLM
                  else ("openai_unavailable_or_no_api_key" if not _openai_client else "unknown"))
        )

    # --- Fallback to rules or patch gaps ---
    if not parsed:
        _parse_stats["rules_calls"] += 1
        parsed = _parse_with_rules(t, s)
        used = "rules"
        logger.info("funding_parse: used=rules reason=%s", llm_reason)
    else:
        # Patch missing fields using rules-based pass (only to fill gaps)
        rules_patch = _parse_with_rules(t, s)
        if not parsed.company and rules_patch.company:
            parsed.company = rules_patch.company
            patched_fields.append("company")
        if not parsed.amount and rules_patch.amount:
            parsed.amount = rules_patch.amount
            patched_fields.append("amount")
        if not parsed.round and rules_patch.round:
            parsed.round = rules_patch.round
            patched_fields.append("round")
        if not parsed.investors and rules_patch.investors:
            parsed.investors = rules_patch.investors
            patched_fields.append("investors")
        if patched_fields:
            _parse_stats["llm_patched"] += 1
        logger.info(
            "funding_parse: used=llm model=%s patched=%s",
            FUNDING_LLM_MODEL,
            (patched_fields or "none"),
        )

    # Final tidy/normalization
    parsed.company = _clean_company(parsed.company)
    parsed.amount = _normalize_amount(parsed.amount)
    parsed.round = _tidy_round(parsed.round) if parsed.round else None
    parsed.investors = _clean_investors(parsed.investors)

    # If after everything it's still clearly a roundup, blank it
    if _looks_like_roundup(t + " " + s):
        _parse_stats["roundups_skipped"] += 1
        logger.info("funding_parse: used=skip_roundup reason=postcheck_roundup_detected")
        return FundingParse(company=None, amount=None, round=None, investors=None)

    # Optional fine-grained debug of final parse (guarded at DEBUG)
    logger.debug(
        "funding_parse: final title=%r company=%r amount=%r round=%r investors=%r path=%s patched=%s",
        title,
        parsed.company,
        parsed.amount,
        parsed.round,
        parsed.investors,
        used,
        (patched_fields or "none"),
    )

    return parsed

# -----------------------------------------------------------------------------
# LLM parsing
# -----------------------------------------------------------------------------
_LLM_SYS_PROMPT = (
    "You are a precise information extractor for startup funding headlines.\n"
    "Given a single headline (and optional summary), extract these fields:\n"
    "- company: the startup/company that raised the money (keep descriptive prefix if part of the name phrase like 'Kitchenware startup Cumin Co').\n"
    "- amount: keep currency and compact units (e.g., $1.5M, US$ 3M, USD 2.2M, INR 10 crore). If no amount present, null.\n"
    "- round: normalize to Seed/Angel/Pre-Series X/Series X/Bridge/Debt/Venture Debt/Growth/etc. "
    "If it only says 'funding round' with no specific label, use 'Funding'. If unknown, null.\n"
    "- investors: lead investor(s) (e.g., 'Fireside Ventures'); otherwise null.\n"
    "If the text is a weekly funding roundup/recap (multiple companies), or not a specific raise, set all fields to null.\n"
    "Return STRICT JSON with keys exactly: company, amount, round, investors. No extra text."
)

_LLM_FEWSHOTS = [
    {
        "title": "Kitchenware startup Cumin Co raises $1.5M in funding round led by Fireside Ventures",
        "summary": "",
        "out": {"company": "Kitchenware startup Cumin Co", "amount": "$1.5M", "round": "Funding", "investors": "Fireside Ventures"},
    },
    {
        "title": "[Weekly funding roundup Aug 9-16] VC inflow into Indian startups on the rise",
        "summary": "",
        "out": {"company": None, "amount": None, "round": None, "investors": None},
    },
    {
        "title": "FintechX secures USD 3 million Seed round from Alpha Capital",
        "summary": "",
        "out": {"company": "FintechX", "amount": "USD 3M", "round": "Seed", "investors": "Alpha Capital"},
    },
    {
        "title": "HealthCo raises INR 20 crore in Series A led by Sequoia India",
        "summary": "",
        "out": {"company": "HealthCo", "amount": "INR 20 crore", "round": "Series A", "investors": "Sequoia India"},
    },
]

def _parse_with_llm(title: str, summary: str) -> Optional[FundingParse]:
    try:
        shots = "\n".join(
            [
                f"Example:\nHeadline: {s['title']}\nSummary: {s['summary']}\nOutput: {json.dumps(s['out'])}"
                for s in _LLM_FEWSHOTS
            ]
        )
        user = f"Headline: {title}\nSummary: {summary}\nRespond with only JSON."

        # small timeout to fail fast
        resp = _openai_client.chat.completions.create(  # type: ignore[attr-defined]
            model=FUNDING_LLM_MODEL,
            temperature=0,
            messages=[
                {"role": "system", "content": _LLM_SYS_PROMPT + "\n\n" + shots},
                {"role": "user", "content": user},
            ],
            timeout=FUNDING_LLM_TIMEOUT,
        )
        txt = (resp.choices[0].message.content or "").strip()
        data = _extract_json(txt)
        if not isinstance(data, dict):
            logger.warning("funding_parse: llm_response_invalid")
            return None

        company = _none_if_empty(_clean_company_phrase(_safe_str(data.get("company"))))
        amount = _none_if_empty(_safe_str(data.get("amount")))
        round_ = _none_if_empty(_safe_str(data.get("round")))
        investors = _none_if_empty(_safe_str(data.get("investors")))

        # If it looks like a roundup, null everything
        if _looks_like_roundup(title + " " + summary):
            return FundingParse(company=None, amount=None, round=None, investors=None)

        return FundingParse(company=company, amount=amount, round=round_, investors=investors)
    except Exception:
        logger.exception("funding_parse: llm_exception")
        return None

def _extract_json(text: str) -> Optional[dict]:
    try:
        return json.loads(text)
    except Exception:
        pass
    try:
        s, e = text.find("{"), text.rfind("}")
        if s != -1 and e != -1 and e > s:
            return json.loads(text[s : e + 1])
    except Exception:
        return None
    return None

# -----------------------------------------------------------------------------
# Rule-based fallback (condensed)
# -----------------------------------------------------------------------------
def _parse_with_rules(title: str, summary: str) -> FundingParse:
    text = (title + " " + summary).strip()
    amount = _extract_amount(text)
    round_ = _extract_round(text)
    investors = _extract_investors(text)
    company = _extract_company(title, summary, amount, round_, investors)
    return FundingParse(company=company, amount=amount, round=round_, investors=investors)

def _norm(s: str) -> str:
    s = (s or "").replace("₹", "INR ").replace("Rs.", "Rs ").replace("Rs", "Rs ")
    s = s.replace("’", "'").replace("–", "-").replace("—", "-")
    s = re.sub(r"\s+", " ", s).strip()
    return s

def _looks_like_roundup(s: str) -> bool:
    s = (s or "").lower()
    return any(
        key in s
        for key in [
            "weekly funding roundup",
            "funding roundup",
            "weekly roundup",
            "this week in funding",
            "funding digest",
            "round-up",
            "round up",
        ]
    )

# ----- amounts -----
def _extract_amount(text: str) -> Optional[str]:
    pats = [
        r"\$[\s]?\d{1,3}(?:[,]\d{3})*(?:\.\d+)?\s*(?:million|mn|billion|bn|m|b)?",
        r"US\$\s*\d{1,3}(?:[,]\d{3})*(?:\.\d+)?\s*(?:million|mn|billion|bn|m|b)?",
        r"USD\s*\d{1,3}(?:[,]\d{3})*(?:\.\d+)?\s*(?:million|mn|billion|bn|m|b)?",
        r"(?:INR|Rs\.?|₹)\s*\d{1,3}(?:[,]\d{2,3})*(?:\.\d+)?\s*(?:crore|cr|lakh|lakhs)?",
        r"\b\d+(?:\.\d+)?\s*(?:crore|cr|lakh|lakhs)\s*(?:INR)?",
        r"\b\d+(?:\.\d+)?\s*(?:m|mn|million|bn|billion)\b",
    ]
    for pat in pats:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            return _normalize_amount(m.group(0))
    return None

def _normalize_amount(amt: Optional[str]) -> Optional[str]:
    if not amt:
        return None
    amt = re.sub(r"\s+", " ", amt).strip()

    # Normalize INR suffix casing
    amt = re.sub(r"\bcr\b", "Cr", amt, flags=re.IGNORECASE)
    amt = re.sub(r"\bcrore\b", "crore", amt, flags=re.IGNORECASE)

    # USD-like amounts -> M/B in uppercase
    if re.match(r"^(?:\$|US\$|USD)", amt, flags=re.IGNORECASE) or amt.startswith("$"):
        amt = re.sub(r"\s*(million|mn|m)\b", "M", amt, flags=re.IGNORECASE)
        amt = re.sub(r"\s*(billion|bn|b)\b", "B", amt, flags=re.IGNORECASE)
        amt = re.sub(r"^(USD)\s+", r"\1 ", amt, flags=re.IGNORECASE)
        amt = re.sub(r"^(US\$)\s+", r"\1 ", amt, flags=re.IGNORECASE)
    else:
        amt = re.sub(r"\b(million|mn|m)\b", "M", amt, flags=re.IGNORECASE)
        amt = re.sub(r"\b(billion|bn|b)\b", "B", amt, flags=re.IGNORECASE)

    return amt.strip()

# ----- round -----
def _extract_round(text: str) -> Optional[str]:
    generic_present = bool(re.search(r"\bfunding\s+round\b", text, flags=re.IGNORECASE))

    pats = [
        rf"\b{_ROUND_WORDS}\s*(?:round)?\b",
        r"\b(pre[-\s]?series\s*[A-K]\s*round)\b",
        r"\b(series\s*[A-K]\s*round)\b",
        r"\b(seed\s*round)\b",
        r"\b(angel\s*round)\b",
        r"\b(bridge\s*round)\b",
        r"\b(venture\s*debt)\b",
        r"\b(debt\s*round)\b",
    ]
    for pat in pats:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            return _tidy_round(m.group(0))
    m = re.search(r"\b(pre[-\s]?series\s*[A-K]|series\s*[A-K])\b", text, flags=re.IGNORECASE)
    if m:
        return _tidy_round(m.group(0))
    if generic_present:
        return "Funding"
    return None

def _tidy_round(s: str) -> str:
    if not s:
        return s
    s = re.sub(r"\s+", " ", s).strip()
    s = s.replace("Pre Series", "Pre-Series").replace("pre series", "Pre-Series")
    s = s.replace("pre-series", "Pre-Series").replace("Pre series", "Pre-Series")
    s = re.sub(r"(?i)\bseries\s*([A-K])\b", lambda m: f"Series {m.group(1).upper()}", s, flags=re.IGNORECASE)
    s = re.sub(r"(?i)\bseed round\b", "Seed", s)
    s = re.sub(r"(?i)\bangel round\b", "Angel", s)
    s = re.sub(r"(?i)\bbridge round\b", "Bridge", s)
    s = re.sub(r"(?i)\bdebt round\b", "Debt", s)
    s = re.sub(r"(?i)\bventure debt\b", "Venture Debt", s)
    return s

# ----- investors -----
def _extract_investors(text: str) -> Optional[str]:
    pats = [
        r"(?:led by|co[-\s]?led by|round led by)\s+(.+?)(?:[,.;]| with | and | along|$)",
        r"(?:from|by|backed by|with participation from|participation from|including|include)\s+(.+?)(?:[,.;]| and | along|$)",
        r"(?:investors?\s+(?:include|including))\s+(.+?)(?:[,.;]| and | along|$)",
    ]
    for pat in pats:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            cand = m.group(1).strip(" ,;.")
            cand = re.sub(
                r"\b(?:for|worth|valued at)\s+\$?\d[\d,\.]*\s*(?:M|mn|million|B|bn|billion|cr|crore|lakh|lakhs)?\b",
                "",
                cand,
                flags=re.IGNORECASE,
            )
            cand = re.sub(r"\s+", " ", cand).strip(" ,;.")
            if cand:
                return cand
    return None

# ----- company -----
def _extract_company(title: str, summary: str, amount: Optional[str], round_: Optional[str], investors: Optional[str]) -> Optional[str]:
    def _depossess(s: str) -> str:
        return re.sub(r"’s|'s", "", s).strip()

    m = re.search(rf"^(.+?)\s+{_VERBS}\b", title, flags=re.IGNORECASE)
    if not m:
        m = re.search(rf"^(.+?)\b{_VERBS}\b", title, flags=re.IGNORECASE)
    if m:
        left = _clean_company_phrase(m.group(1))
        if left:
            return _depossess(left)

    combined = (title + " " + summary).strip()
    m = re.search(r"\b(?:round|funding|investment)\s+for\s+(.+?)(?:[,.;]|$)", combined, flags=re.IGNORECASE)
    if m:
        return _depossess(_clean_company_phrase(m.group(1)))

    m = re.search(r"\b(.+?)\s*(?:’s|'s)\s+(?:.*?\bround\b|funding)\b", combined, flags=re.IGNORECASE)
    if m:
        return _depossess(_clean_company_phrase(m.group(1)))

    m = re.search(rf"\b(?:{_ROUND_WORDS})\b\s*:\s*(.+?)\s+{_VERBS}\b", title, flags=re.IGNORECASE)
    if m:
        return _depossess(_clean_company_phrase(m.group(1)))

    cand = _first_proper_chunk(title)
    if cand:
        return _depossess(_clean_company_phrase(cand))

    return None

def _clean_company_phrase(s: str) -> str:
    s = s.strip(" ,;.-")
    s = re.sub(rf"^{_descriptor_leads}\s*,?\s*", "", s, flags=re.IGNORECASE)
    s = re.split(r"\s*,\s*(?:an?|the)\b|\s*,\s*(?:a|an)\s+\w+", s, maxsplit=1, flags=re.IGNORECASE)[0]
    s = re.sub(r",\s*the\s+[^,]+$", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+", " ", s).strip(" ,;.-")
    return s

def _first_proper_chunk(text: str) -> Optional[str]:
    m = re.search(rf"(.+?)\s+{_VERBS}\b", text, flags=re.IGNORECASE)
    cand = m.group(1) if m else text
    tokens = cand.split()
    buff = []
    for w in tokens:
        if re.match(r"^(?:Series|Seed|Pre[-\s]?Series|Funding|Round)$", w, flags=re.IGNORECASE):
            break
        if _looks_like_name_part(w):
            buff.append(w)
        elif buff:
            break
    phrase = " ".join(buff).strip(" ,;.-")
    return phrase or None

def _looks_like_name_part(w: str) -> bool:
    if re.match(r"^[A-Z][\w\.\-&]*$", w):
        return True
    if re.match(r"^[A-Z0-9\&\-\.]{2,}$", w):
        return True
    return False

def _clean_company(s: Optional[str]) -> Optional[str]:
    if not s:
        return s
    s = re.sub(r"\s+", " ", s).strip(" ,;.-")
    # Keep descriptive prefix if part of phrase (e.g., "Kitchenware startup Cumin Co")
    s = re.sub(r"\b(startup|company|firm|platform|app|venture|business)\b$", "", s, flags=re.IGNORECASE).strip()
    return s or None

def _clean_investors(s: Optional[str]) -> Optional[str]:
    if not s:
        return s
    s = re.sub(r"\s+", " ", s).strip(" ,;.")
    s = s.replace(" and ", ", ")
    s = re.sub(r"\s*,\s*", ", ", s)
    return s or None

# -----------------------------------------------------------------------------
# Small utils
# -----------------------------------------------------------------------------
def _safe_str(v) -> str:
    return "" if v is None else str(v)

def _none_if_empty(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v if v else None
