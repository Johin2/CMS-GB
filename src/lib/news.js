// Shared helpers for all news routes (no regex)

export function pad2(n) { return n < 10 ? "0" + n : "" + n; }

export function toSqliteTextUTC(dt) {
  const y = dt.getUTCFullYear();
  const m = pad2(dt.getUTCMonth() + 1);
  const d = pad2(dt.getUTCDate());
  const H = pad2(dt.getUTCHours());
  const M = pad2(dt.getUTCMinutes());
  const S = pad2(dt.getUTCSeconds());
  return `${y}-${m}-${d} ${H}:${M}:${S}`;
}

export function nowISO() { return new Date().toISOString(); }

export function toISOorEmpty(v) {
  try {
    const d = v ? new Date(v) : null;
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toISOString();
  } catch { return ""; }
}

export function monthLabelFromISO(iso) {
  try {
    const d = new Date(iso);
    const good = Number.isNaN(d.getTime()) ? new Date() : d;
    return good.toLocaleString("en-US", { month: "long" });
  } catch {
    return new Date().toLocaleString("en-US", { month: "long" });
  }
}

export function normalizeUrl(u) {
  try {
    const url = new URL(u);
    const drop = [];
    url.searchParams.forEach((_, k) => {
      const low = String(k || "").toLowerCase();
      if (low.startsWith("utm_") || low === "fbclid" || low === "gclid") drop.push(k);
    });
    for (const k of drop) url.searchParams.delete(k);
    return url.toString();
  } catch { return String(u || ""); }
}

// ─── NEW: parse GDELT seendate (YYYYMMDDhhmmss) into ISO ───
export function gdeltSeendateToISO(s) {
  const t = String(s || "").trim();
  const isDigits = (str) => {
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 48 || c > 57) return false;
    }
    return true;
  };
  if (t.length === 14 && isDigits(t)) {
    const Y = Number(t.slice(0, 4));
    const M = Number(t.slice(4, 6));
    const D = Number(t.slice(6, 8));
    const h = Number(t.slice(8, 10));
    const m = Number(t.slice(10, 12));
    const s2 = Number(t.slice(12, 14));
    const d = new Date(Date.UTC(Y, M - 1, D, h, m, s2));
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  if (t.length === 8 && isDigits(t)) {
    const Y = Number(t.slice(0, 4));
    const M = Number(t.slice(4, 6));
    const D = Number(t.slice(6, 8));
    const d = new Date(Date.UTC(Y, M - 1, D, 0, 0, 0));
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  // Fallback to native Date parser for anything else
  return toISOorEmpty(t);
}

// ─── Normalizers (unchanged logic) ───
function uc(w) { return w ? w[0].toUpperCase() + w.slice(1) : ""; }
function ucwords(s) { return String(s || "").split(" ").filter(Boolean).map(uc).join(" "); }

const ROLE_TOKENS = [
  "chief executive officer","chief marketing officer","chief financial officer",
  "chief technology officer","chief operating officer","chief product officer",
  "president","chairman","managing director","vice chairman",
  "svp","evp","vp","md","ceo","cmo","cfo","cto","coo","cpo","head of"
];

function canonicalRoleWord(r) {
  const low = String(r || "").toLowerCase().trim();
  const map = {
    "chief executive officer":"CEO","chief marketing officer":"CMO","chief financial officer":"CFO",
    "chief technology officer":"CTO","chief operating officer":"COO","chief product officer":"CPO",
    "managing director":"MD","vice chairman":"Vice Chairman","president":"President","chairman":"Chairman",
    "svp":"SVP","evp":"EVP","vp":"VP","md":"MD","ceo":"CEO","cmo":"CMO","cfo":"CFO","cto":"CTO","coo":"COO","cpo":"CPO","head of":"Head of"
  };
  return map[low] || ucwords(low);
}

function firstIndexOfAny(hayLower, tokens) {
  let best = { index: -1, token: "" };
  for (const t of tokens) {
    const i = hayLower.indexOf(String(t).toLowerCase());
    if (i >= 0 && (best.index === -1 || i < best.index)) best = { index: i, token: t };
  }
  return best;
}

function lstripOf(s) {
  const t = String(s || "").trim();
  const low = t.toLowerCase();
  return low.startsWith("of ") ? t.slice(3).trim() : t;
}

function stripPossessive(x) {
  const i1 = x.indexOf("’s"); const i2 = x.indexOf("'s");
  const i = i1 >= 0 ? i1 : i2;
  return i > 0 ? x.slice(0, i) : x;
}

function cleanCompany(s) {
  let x = stripPossessive(String(s || "").trim());
  const low = x.toLowerCase();
  const dropWords = [" unit"," division"," arm"," business"," vertical"," team"," wing"," branch"];
  let cut = -1;
  for (const w of dropWords) {
    const j = low.indexOf(w);
    if (j >= 0 && (cut === -1 || j < cut)) cut = j;
  }
  if (cut >= 0) x = x.slice(0, cut).trim();
  if (x.toLowerCase().startsWith("the ")) x = x.slice(4).trim();
  if (x.indexOf(",") >= 0) {
    const parts = x.split(",").map(p => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.length <= 40) x = last;
  }
  return x;
}

function pickCity(text) {
  const CITIES = [
    "mumbai","bengaluru","bangalore","delhi","new delhi","gurgaon","gurugram","noida",
    "pune","hyderabad","chennai","kolkata","ahmedabad","jaipur","kochi","trivandrum",
    "thiruvananthapuram","indore","bhopal","lucknow","surat","coimbatore","patna"
  ];
  const low = String(text || "").toLowerCase();
  for (const c of CITIES) if (low.indexOf(c) >= 0) return c.split(" ").map(uc).join(" ");
  return "";
}

function classifyCategory(titleLower) {
  const CHANGE = [" appointed "," appoints "," joins "," joined "," promoted "," elevated "," named "," names "," replaces "," steps down "," retires "," leaves "];
  const ACH = [" wins "," awarded "," recognised "," recognized "," honored "," honoured "," keynote "," listed "," makes the list "," featured "," secures award "," gets award "];
  for (const w of CHANGE) if (titleLower.indexOf(w) >= 0) return "Role Change";
  for (const w of ACH) if (titleLower.indexOf(w) >= 0) return "Achievement";
  return "";
}

function splitRoleCompanyLoose(text) {
  const s = String(text || "").trim();
  const low = s.toLowerCase();
  const found = firstIndexOfAny(low, ROLE_TOKENS);
  if (found.index >= 0) {
    const pre = s.slice(0, found.index).trim();
    const company = cleanCompany(lstripOf(pre));
    const role = canonicalRoleWord(found.token);
    if (company && role) return { role, company };
  }
  return { role: "", company: "" };
}

function cutAt(title) {
  const cuts = [" | ", " - ", " — ", " – "];
  let s = String(title || "").trim();
  for (const c of cuts) {
    const i = s.lastIndexOf(c);
    if (i > 20) { s = s.slice(0, i); break; }
  }
  return s;
}

function stripHonorific(s) {
  const t = String(s || "").trim();
  const low = t.toLowerCase();
  const cands = ["mr. ", "mr ", "ms. ", "ms ", "mrs. ", "mrs "];
  for (const c of cands) if (low.startsWith(c)) return t.slice(c.length).trim();
  return t;
}

function extractHeuristic(a) {
  const raw = cutAt(a.title || "");
  const tl = raw.toLowerCase();
  const category = classifyCategory(tl);
  if (!category) return null;

  let person = "", role = "", company = "";

  const actionA = [" appointed ", " named ", " promoted to ", " promoted ", " elevated "];
  const sepWords = [" at ", " for ", " of "];
  const actA = firstIndexOfAny(tl, actionA);
  if (actA.index >= 0) {
    person = raw.slice(0, actA.index).trim();
    let rest = raw.slice(actA.index + actA.token.length).trim();
    const lowRest = rest.toLowerCase();
    if (lowRest.startsWith("as ")) rest = rest.slice(3).trim();
    const sep = firstIndexOfAny(lowRest, sepWords);
    if (sep.index >= 0) {
      role = rest.slice(0, sep.index).trim();
      company = rest.slice(sep.index + sep.token.length).trim();
    } else {
      role = rest.trim();
    }
  }

  if (!person) {
    const actB = firstIndexOfAny(tl, [" joins ", " joined "]);
    if (actB.index >= 0) {
      person = raw.slice(0, actB.index).trim();
      const rest = raw.slice(actB.index + actB.token.length).trim();
      const lowR = rest.toLowerCase();
      const asIdx = lowR.indexOf(" as ");
      if (asIdx >= 0) {
        company = rest.slice(0, asIdx).trim();
        role = rest.slice(asIdx + 4).trim();
      } else {
        company = rest.trim();
      }
    }
  }

  if (!person) {
    const actC = firstIndexOfAny(tl, [" appoints ", " names "]);
    if (actC.index >= 0) {
      company = raw.slice(0, actC.index).trim();
      const rest = raw.slice(actC.index + actC.token.length).trim();
      const lowR = rest.toLowerCase();
      const asIdx = lowR.indexOf(" as ");
      if (asIdx >= 0) {
        person = rest.slice(0, asIdx).trim();
        role = rest.slice(asIdx + 4).trim();
      } else {
        const guess = splitRoleCompanyLoose(rest);
        person = guess.role ? rest.trim() : rest.trim();
        if (!role) role = guess.role;
      }
    }
  }

  if (!company || !role) {
    const tail = splitRoleCompanyLoose(raw);
    if (!role) role = tail.role;
    if (!company) company = tail.company;
  }

  const city = pickCity(a.description || a.title);
  person = stripHonorific(person);
  role = canonicalRoleWord(role);
  company = cleanCompany(company);

  if (!role || !company) return null;

  const published = a.publishedAt && toISOorEmpty(a.publishedAt) ? toISOorEmpty(a.publishedAt) : nowISO();

  return {
    person_name: ucwords(person),
    role,
    company,
    city,
    category,
    publishedAt: published,
    url: normalizeUrl(a.url || ""),
    source: a.source || "",
    title: a.title || "",
    summary: a.description || ""
  };
}

export function heuristicNormalize(items) {
  const out = [];
  for (const a of items) {
    const h = extractHeuristic(a);
    if (h) out.push(h);
  }
  return out;
}

export async function fetchSafe(url, init) {
  try {
    const resp = await fetch(url.toString(), init);
    const body = await resp.text().catch(() => "");
    return { ok: resp.ok, status: resp.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: `network-error: ${e && e.message ? e.message : e}` };
  }
}

export async function googleNewsRSS(query) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-IN");
  url.searchParams.set("gl", "IN");
  url.searchParams.set("ceid", "IN:en");

  const res = await fetchSafe(url, {});
  if (!res.ok) return [];

  const xml = res.body || "";
  const items = [];
  let cursor = 0;

  const getTag = (src, tag) => {
    const open = "<" + tag + ">";
    const close = "</" + tag + ">";
    const i = src.indexOf(open);
    if (i === -1) return "";
    const j = src.indexOf(close, i + open.length);
    if (j === -1) return "";
    return src.slice(i + open.length, j);
  };
  const decode = (s) => {
    const t = String(s || "").trim();
    const isCDATA = t.startsWith("<![CDATA[") && t.endsWith("]]>");
    const inner = isCDATA ? t.slice(9, t.length - 3) : t;
    return inner
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .trim();
  };

  while (true) {
    const start = xml.indexOf("<item>", cursor);
    if (start === -1) break;
    const end = xml.indexOf("</item>", start);
    if (end === -1) break;
    const chunk = xml.slice(start + 6, end);
    cursor = end + 7;

    const title = decode(getTag(chunk, "title"));
    const link = decode(getTag(chunk, "link"));
    const pubRaw = getTag(chunk, "pubDate");
    const src = decode(getTag(chunk, "source"));
    const desc = decode(getTag(chunk, "description"));

    items.push({
      title,
      description: desc,
      url: normalizeUrl(link),
      source: src || "Google News",
      publishedAt: toISOorEmpty(pubRaw)
    });
  }
  return items;
}

// ─── UPDATED: use gdeltSeendateToISO ───
export async function gdelt7d() {
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set(
    "query",
    'sourceCountry:IN (appointed OR joins OR promoted OR named OR elevated OR awarded OR wins OR recognised OR recognition OR honor OR honoured OR keynote OR list)'
  );
  url.searchParams.set("timespan", "7d");
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("maxrecords", "120");
  url.searchParams.set("format", "json");

  const res = await fetchSafe(url, {});
  if (!res.ok) return [];
  let payload = {};
  try { payload = JSON.parse(res.body || "{}"); } catch {}
  const arts = Array.isArray(payload.articles) ? payload.articles : [];
  return arts.map((a) => ({
    title: a && a.title ? a.title : "",
    description: a && a.sourceCommonName ? a.sourceCommonName : "",
    url: normalizeUrl(a && a.url ? a.url : ""),
    source: a && a.sourceCommonName ? a.sourceCommonName : "GDELT",
    publishedAt: gdeltSeendateToISO(a && a.seendate ? a.seendate : "")
  }));
}

// NEW: range-capable GDELT fetch (chunked by 14 days)
function fmtGdelt(d) {
  const Y = d.getUTCFullYear();
  const M = pad2(d.getUTCMonth() + 1);
  const D = pad2(d.getUTCDate());
  const h = pad2(d.getUTCHours());
  const m = pad2(d.getUTCMinutes());
  const s = pad2(d.getUTCSeconds());
  return `${Y}${M}${D}${h}${m}${s}`;
}

export async function gdeltRange(fromISO, toISO) {
  const out = [];
  const start = new Date(fromISO);
  const end = new Date(toISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;

  const stepMs = 14 * 86400000;
  for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
    const a = new Date(t);
    const b = new Date(Math.min(t + stepMs - 1000, end.getTime()));
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", 'sourceCountry:IN (appointed OR joins OR promoted OR named OR elevated OR awarded OR wins OR recognised OR recognition OR honor OR honoured OR keynote OR list)');
    url.searchParams.set("startdatetime", fmtGdelt(a));
    url.searchParams.set("enddatetime", fmtGdelt(b));
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("maxrecords", "250");
    const res = await fetchSafe(url, {});
    if (!res.ok) continue;
    let payload = {};
    try { payload = JSON.parse(res.body || "{}"); } catch {}
    const arts = Array.isArray(payload.articles) ? payload.articles : [];
    for (const x of arts) {
      out.push({
        title: x && x.title ? x.title : "",
        description: x && x.sourceCommonName ? x.sourceCommonName : "",
        url: normalizeUrl(x && x.url ? x.url : ""),
        source: x && x.sourceCommonName ? x.sourceCommonName : "GDELT",
        publishedAt: gdeltSeendateToISO(x && x.seendate ? x.seendate : "")
      });
    }
  }
  return out;
}

export function ensureNewsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS news (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      person_name   TEXT,
      role          TEXT,
      company       TEXT,
      email         TEXT,
      city          TEXT,
      month_label   TEXT,
      category      TEXT,
      source        TEXT,
      url           TEXT,
      title         TEXT,
      summary       TEXT,
      published_at  TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      linkedin_url  TEXT
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_news_published_at ON news(published_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_news_created_at   ON news(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_news_company      ON news(company);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_news_person_name  ON news(person_name);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_news_category     ON news(category);`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_news_url_unique ON news(url);`);
}
