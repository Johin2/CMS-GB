// src/lib/news-ai.js
// LLM-powered smart curation for Indian business news.
// - De-dupe near-duplicates
// - Reject sports/government/bureaucracy
// - Extract {person_name, role, company, city, category, published_at, url, source, title, summary}
// - Keep output tight for your table.
// Falls back is handled by callers if LLM is unavailable.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

function uc(w){ return w ? w[0].toUpperCase() + w.slice(1) : ""; }
function ucwords(s){ return String(s||"").split(" ").filter(Boolean).map(uc).join(" "); }

// Canonicalize roles to short forms used by your table
const ROLE_MAP = {
  "chief executive officer":"CEO","chief marketing officer":"CMO","chief financial officer":"CFO",
  "chief technology officer":"CTO","chief operating officer":"COO","chief product officer":"CPO",
  "managing director":"MD","vice chairman":"Vice Chairman","president":"President","chairman":"Chairman",
  "svp":"SVP","evp":"EVP","vp":"VP","md":"MD","ceo":"CEO","cmo":"CMO","cfo":"CFO","cto":"CTO","coo":"COO","cpo":"CPO","head of":"Head of"
};
function canonicalRoleWord(r) {
  const low = String(r || "").toLowerCase().trim();
  if (ROLE_MAP[low]) return ROLE_MAP[low];
  for (const k of Object.keys(ROLE_MAP)) if (low.includes(k)) return ROLE_MAP[k];
  for (const t of ["ceo","cfo","cto","coo","cmo","cpo","md","vp","svp","evp","president","chairman","head of"]) {
    if (low.includes(t)) return canonicalRoleWord(t);
  }
  return String(r || "").split(" ").filter(Boolean).map(uc).slice(0,3).join(" ");
}

const COMPANY_SUFFIXES = [" ltd"," limited"," pvt"," private"," plc"," llp"," inc"," bank"," motors"," services"," technologies"," tech"," labs"," systems"," industries"," finance"," capital"," media"," foods"," pharma"," healthcare"," hospitals"," steel"," cement"," airlines"," air"," digital"," india"," global"," group"];
function isLikelyPersonName(s){
  const t=String(s||"").trim(); if(!t) return false;
  const lc=t.toLowerCase(); if (COMPANY_SUFFIXES.some(suf => lc.endsWith(suf))) return false;
  if (t===t.toUpperCase() && t.length<=6) return false; // e.g., TCS, IKEA
  const parts=t.split(" ").filter(Boolean);
  if (parts.length===2 || parts.length===3) {
    let caps=0; for (const p of parts){const c=p.charCodeAt(0); if(c>=65 && c<=90) caps++;}
    if (caps===parts.length) return true;
  }
  return false;
}

// Batcher so we don't overload tokens; ~40 items per call is a safe sweet spot
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildPrompt(items) {
  // We give extremely explicit rules and schema to the model.
  return [
    {
      role: "system",
      content:
`You are a strict data-normalization engine for Indian business news.
- Only return JSON per the schema. No extra text.
- Keep only items about role changes or executive achievements in Indian companies or brands.
- EXCLUDE sports (cricket/football/tennis), tournaments, commentary, 'vs/v' matches, BCCI, scores.
- EXCLUDE government/bureaucracy/police/ministry/IAS/IPS/IFS/IRS/MLA/MP/CM/PM or .gov.in/.nic.in sites.
- Focus on India-only items (site .in or explicitly linked to India/cities/Indian brands).
- Extract a single PERSON name (no titles like Mr./Ms/Ex-/Veteran).
- Extract a single ROLE, canonical short (CEO, CFO, CTO, COO, CMO, CPO, MD, VP, SVP, EVP, President, Chairman, Head of).
- Extract a single COMPANY/brand name (never a person).
- CATEGORY must be exactly "Role Change" or "Achievement".
- PUBLISHED_AT must be a valid ISO timestamp (or empty if unknown).`
    },
    {
      role: "user",
      content:
`Normalize the following items using this JSON schema:
{
  "items": [{
    "keep": true|false,
    "reason": "why kept or rejected in one short phrase",
    "person_name": "string",     // proper case
    "role": "string",            // canonical short: CEO/CFO/...
    "company": "string",         // brand/company only
    "city": "string",            // empty if not explicit
    "category": "Role Change"|"Achievement",
    "published_at": "ISO string",
    "url": "string",
    "source": "string",
    "title": "string",
    "summary": "string"
  }],
  "dedup_notes": "short description of duplicates merged"
}

Rules:
- Reject if sports/government/bureaucracy/celebrity event unrelated to leadership moves or awards.
- Reject if company field looks like a person.
- When multiple near-duplicate items exist, keep one best row and mark the others keep=false.
- Never fabricate details; if in doubt, set fields to empty string and keep=false.
- Output only JSON.`,
    },
    {
      role: "user",
      content: JSON.stringify({ items })
    }
  ];
}

async function callOpenAI(messages, { apiKey, model, baseURL }) {
  const url = `${baseURL.replace(/\/+$/,"")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=>"");
    throw new Error(`OpenAI error ${res.status}: ${txt.slice(0,200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(text);
}

// Public: takes raw items [{title, description, url, source, publishedAt}] and returns curated normalized rows.
export async function aiSmartCurate(items, opts = {}) {
  const apiKey = opts.apiKey || OPENAI_API_KEY;
  if (!apiKey || !items || !items.length) return { rows: [], dedupNotes: "", usedLLM: false };

  const model  = opts.model  || OPENAI_MODEL;
  const baseURL= opts.baseURL|| OPENAI_BASE_URL;

  // Keep payload compact to save tokens
  const payload = items.map(i => ({
    title: i?.title || "",
    description: i?.description || "",
    url: i?.url || "",
    source: i?.source || "",
    published_at: i?.publishedAt || ""
  }));

  const chunks = chunk(payload, 40);
  const allRows = [];
  let dedupNotes = [];

  for (const part of chunks) {
    const messages = buildPrompt(part);
    let parsed;
    try {
      parsed = await callOpenAI(messages, { apiKey, model, baseURL });
    } catch (e) {
      // Fail soft: return what we have so far; callers will fall back
      return { rows: [], dedupNotes: "", usedLLM: false, error: e.message };
    }
    const rows = Array.isArray(parsed?.items) ? parsed.items : [];
    if (parsed?.dedup_notes) dedupNotes.push(String(parsed.dedup_notes));

    for (const r of rows) {
      if (!r || r.keep !== true) continue;
      // Final local guardrails
      const role = canonicalRoleWord(r.role);
      const company = String(r.company || "").trim();
      const name = ucwords(String(r.person_name || "").trim());
      if (!role || !company || !name) continue;
      if (isLikelyPersonName(company)) continue;

      allRows.push({
        person_name: name,
        role,
        company,
        city: String(r.city || "").trim(),
        category: r.category === "Achievement" ? "Achievement" : "Role Change",
        publishedAt: String(r.published_at || "").trim(),
        url: String(r.url || "").trim(),
        source: String(r.source || "").trim(),
        title: String(r.title || "").trim(),
        summary: String(r.summary || "").trim()
      });
    }
  }

  // De-dupe by (person_name, role, company, month-day)
  const seen = new Set();
  const deduped = [];
  for (const row of allRows) {
    const keyDate = (row.publishedAt || "").slice(0,10); // yyyy-mm-dd
    const k = `${row.person_name}|${row.role}|${row.company}|${keyDate}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(row);
  }

  return { rows: deduped, dedupNotes: dedupNotes.join(" | ").slice(0, 400), usedLLM: true };
}
