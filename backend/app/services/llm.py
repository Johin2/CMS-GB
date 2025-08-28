import json
import os
from typing import Dict, Optional

# Optional import: if not available, we degrade gracefully
try:
    from openai import OpenAI  # pip install openai>=1.0.0
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore

_DEFAULT_MODEL = os.getenv("LLM_MODEL", "gpt-4.1-mini")

_SYSTEM = (
    "You extract structured fields from a single news headline about a people movement. "
    "Return a compact JSON object with keys: company, name, designation"
    "Make sure to properly parse the data in the correct format"
    "eg: Abraham Thomas appointed as Radio City's Chief Executive Officer"
    "Output: company: Radio City, name: Abraham Thomas, designation: CEO-Chief Executive Office"
    ""
    "Do not invent emails. Leave unknowns empty."
)

def _client() -> Optional["OpenAI"]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or OpenAI is None:
        return None
    try:
        return OpenAI(api_key=api_key)
    except Exception:
        return None

def parse_people_title_llm(title: str) -> Dict[str, Optional[str]]:
    """
    Returns: {
      "company": str|None, "name": str|None, "designation": str|None,
      "ambassador_featuring": str|None, "promoting": str|None, "location": str|None
    }
    If no key or SDK not available, returns {}.
    """
    cli = _client()
    if cli is None or not title:
        return {}

    prompt = (
        "Headline:\n"
        f"{title}\n\n"
        "Rules:\n"
        "- If the company leads the sentence (e.g., 'ACME appoints Bob as CTO'), set company='ACME', "
        "  name='Bob', designation='CTO'.\n"
        "- If a person leads (e.g., 'Alice joins ACME as VP'), set name='Alice', company='ACME', designation='VP'.\n"
        "- For 'elevated/promoted to ROLE at COMPANY', set designation='ROLE' and company='COMPANY'.\n"
        "- If 'brand ambassador' like phrasing is present, set ambassador_featuring to the celebrity/figure.\n"
        "- Keep the output minimal and factual from the headline only.\n"
        "Return JSON only."
    )

    try:
        resp = cli.chat.completions.create(
            model=_DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
        )
        text = resp.choices[0].message.content or "{}"
        # Be robust to non-JSON by extracting last {...}
        text = text[text.find("{") : text.rfind("}") + 1] if "{" in text else "{}"
        data = json.loads(text)
        # Normalize keys we care about
        return {
            "company": data.get("company") or None,
            "name": data.get("name") or None,
            "designation": data.get("designation") or None,
            "ambassador_featuring": data.get("ambassador_featuring") or None,
            "promoting": data.get("promoting") or None,
            "location": data.get("location") or None,
        }
    except Exception:
        return {}
