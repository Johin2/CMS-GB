// no regexes
import { db, cuid, nowISO } from "@lib/sqlite";

function toISOorEmpty(v) {
  try { const d = v ? new Date(v) : null; return (!d || Number.isNaN(d.getTime())) ? "" : d.toISOString(); }
  catch { return ""; }
}
const monthName = (d) => d.toLocaleString("en-US", { month: "long" });
const monthLabelFromISO = (iso) => {
  try { const d = new Date(iso); return Number.isNaN(d.getTime()) ? monthName(new Date()) : monthName(d); }
  catch { return monthName(new Date()); }
};
function normalizeUrl(u) {
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
function ensureNewsTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY,
      person_name TEXT,
      role TEXT,
      email TEXT,
      company TEXT,
      city TEXT,
      url TEXT UNIQUE,
      source TEXT,
      published_at TEXT,
      month_label TEXT,
      category TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_news_month     ON news_items(month_label);
    CREATE INDEX IF NOT EXISTS idx_news_date      ON news_items(published_at);
    CREATE INDEX IF NOT EXISTS idx_news_company   ON news_items(company);
    CREATE INDEX IF NOT EXISTS idx_news_category  ON news_items(category);
  `);
}

/* ---------- minimal heuristic normalization (same as your weekly file) ---------- */
const ROLE_TOKENS = ["chief executive officer","chief marketing officer","chief financial officer","chief technology officer","chief operating officer","chief product officer","president","chairman","managing director","vice chairman","svp","evp","vp","md","ceo","cmo","cfo","cto","coo","cpo","head of"];
function uc(w){ return w ? w[0].toUpperCase() + w.slice(1) : ""; }
function ucwords(s){ return String(s||"").split(" ").filter(Boolean).map(uc).join(" "); }
function canonicalRoleWord(r){
  const low = String(r||"").toLowerCase().trim();
  const map = { "chief executive officer":"CEO","chief marketing officer":"CMO","chief financial officer":"CFO","chief technology officer":"CTO","chief operating officer":"COO","chief product officer":"CPO","managing director":"MD","vice chairman":"Vice Chairman","president":"President","chairman":"Chairman","svp":"SVP","evp":"EVP","vp":"VP","md":"MD","ceo":"CEO","cmo":"CMO","cfo":"CFO","cto":"CTO","coo":"COO","cpo":"CPO","head of":"Head of" };
  return map[low] || ucwords(low);
}
function firstIndexOfAny(hay, tokens){
  let best = { index:-1, token:"" }; const lower = String(hay||"").toLowerCase();
  for (const t of tokens){ const i = lower.indexOf(t.toLowerCase()); if (i>=0 && (best.index===-1 || i<best.index)) best = { index:i, token:t }; }
  return best;
}
function cutAt(title){
  const cuts = [" | "," - "," — "," – "]; let s = String(title||"").trim();
  for (const c of cuts){ const i = s.lastIndexOf(c); if (i>20){ s = s.slice(0,i); break; } } return s;
}
function stripPossessive(x){ const i1 = x.indexOf("’s"); const i2 = x.indexOf("'s"); const i = i1>=0 ? i1 : i2; return i>0 ? x.slice(0,i) : x; }
function cleanCompany(s){
  let x = stripPossessive(String(s||"").trim());
  const low = x.toLowerCase(); const dropWords = [" unit"," division"," arm"," business"," vertical"," team"," wing"," branch"]; let cut = -1;
  for (const w of dropWords){ const j = low.indexOf(w); if (j>=0 && (cut===-1 || j<cut)) cut = j; }
  if (cut>=0) x = x.slice(0,cut).trim();
  if (x.toLowerCase().startsWith("the ")) x = x.slice(4).trim();
  if (x.indexOf(",")>=0){ const parts = x.split(",").map(p=>p.trim()).filter(Boolean); const last = parts[parts.length-1]; if (last && last.length<=40) x = last; }
  return ucwords(x);
}
function pickCity(text){
  const CITIES = ["mumbai","bengaluru","bangalore","delhi","new delhi","gurgaon","gurugram","noida","pune","hyderabad","chennai","kolkata","ahmedabad","jaipur","kochi","trivandrum","thiruvananthapuram","indore","bhopal","lucknow","surat","coimbatore","patna"];
  const low = String(text||"").toLowerCase(); for (const c of CITIES){ if (low.indexOf(c)>=0) return ucwords(c); } return "";
}
function classifyCategory(titleLower){
  const CHANGE = [" appointed "," appoints "," joins "," joined "," promoted "," elevated "," named "," names "," replaces "," steps down "," retires "," leaves "];
  const ACH    = [" wins "," awarded "," recognised "," recognized "," honored "," honoured "," keynote "," listed "," makes the list "," featured "," secures award "," gets award "];
  for (const w of CHANGE) if (titleLower.indexOf(w)>=0) return "Role Change";
  for (const w of ACH)    if (titleLower.indexOf(w)>=0) return "Achievement";
  return "";
}
function splitRoleCompanyLoose(text){
  const s = String(text||"").trim(); const low = s.toLowerCase();
  const { index, token } = firstIndexOfAny(low, ROLE_TOKENS);
  if (index>=0){ const company = cleanCompany(s.slice(0,index).trim().replace(/^of\s+/i, "")); const role = canonicalRoleWord(token);
    if (company && role) return { role, company };
  }
  return { role:"", company:"" };
}
function extractHeuristic(item){
  const raw = cutAt(item.title || item.description || item.content || ""); const tl = raw.toLowerCase(); const category = classifyCategory(tl);
  if (!category) return null;
  let person = "", role = "", company = "";
  const actA = firstIndexOfAny(tl, [" appointed ", " named ", " promoted to ", " promoted ", " elevated "]);
  if (actA.index>=0){
    person = raw.slice(0, actA.index).trim();
    let rest = raw.slice(actA.index + actA.token.length).trim();
    if (rest.toLowerCase().startsWith("as ")) rest = rest.slice(3).trim();
    const sep = firstIndexOfAny(rest.toLowerCase(), [" at ", " for ", " of "]);
    if (sep.index>=0){ role = rest.slice(0, sep.index).trim(); company = rest.slice(sep.index + sep.token.length).trim(); }
    else { role = rest.trim(); }
  }
  if (!person){
    const actB = firstIndexOfAny(tl, [" joins ", " joined "]);
    if (actB.index>=0){
      person = raw.slice(0, actB.index).trim();
      const rest = raw.slice(actB.index + actB.token.length).trim();
      const asIdx = rest.toLowerCase().indexOf(" as ");
      if (asIdx>=0){ company = rest.slice(0, asIdx).trim(); role = rest.slice(asIdx + 4).trim(); }
      else company = rest.trim();
    }
  }
  if (!person){
    const actC = firstIndexOfAny(tl, [" appoints ", " names "]);
    if (actC.index>=0){
      company = raw.slice(0, actC.index).trim();
      const rest = raw.slice(actC.index + actC.token.length).trim();
      const asIdx = rest.toLowerCase().indexOf(" as ");
      if (asIdx>=0){ person = rest.slice(0, asIdx).trim(); role = rest.slice(asIdx + 4).trim(); }
      else { const guess = splitRoleCompanyLoose(rest); person = guess.person || rest.trim(); if (!role) role = guess.role; }
    }
  }
  if (!company || !role){ const tail = splitRoleCompanyLoose(raw); if (!role) role = tail.role; if (!company) company = tail.company; }
  const city = pickCity(item.description || item.content || item.title || "");
  person = person.replace(/^Mr\.?\s+/i, "").replace(/^Ms\.?\s+/i, "").trim();
  role = canonicalRoleWord(role); company = cleanCompany(company);
  if (!role || !company) return null;
  return { person_name: ucwords(person), role, company, city, category, publishedAt: item.publishedAt || nowISO(), url: item.url || "", source: item.source || "" };
}
function heuristicNormalize(items){ const out = []; for (const a of items){ const h = extractHeuristic(a); if (h) out.push(h); } return out; }

/* ---------- GDELT range fetch (backfill-friendly) ---------- */
function fmtGdelt(d){
  const pad = (n)=> (n<10?"0"+n:String(n));
  const Y = d.getUTCFullYear();
  const M = pad(d.getUTCMonth()+1);
  const D = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const m = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return `${Y}${M}${D}${h}${m}${s}`;
}
async function fetchSafe(url, init){
  try { const resp = await fetch(url.toString(), init); const body = await resp.text().catch(()=> ""); return { ok: resp.ok, status: resp.status, body }; }
  catch(e){ return { ok:false, status:0, body: String(e?.message || e) }; }
}
async function gdeltRange(fromISO, toISO){
  const out = [];
  const start = new Date(fromISO); const end = new Date(toISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;

  // chunk the range into 14-day windows to avoid maxrecords caps
  const stepMs = 14 * 86400000;
  for (let t = start.getTime(); t < end.getTime(); t += stepMs){
    const a = new Date(t);
    const b = new Date(Math.min(t + stepMs - 1000, end.getTime()));
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", 'sourceCountry:IN (appointed OR joins OR promoted OR named OR elevated OR awarded OR wins OR recognised OR recognition OR honor OR honoured OR keynote OR list)');
    url.searchParams.set("startdatetime", fmtGdelt(a));
    url.searchParams.set("enddatetime",   fmtGdelt(b));
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("maxrecords", "250");
    const res = await fetchSafe(url, {});
    if (!res.ok) continue;
    let payload = {};
    try { payload = JSON.parse(res.body || "{}"); } catch {}
    const arts = Array.isArray(payload.articles) ? payload.articles : [];
    for (const x of arts){
      out.push({
        title: x?.title || "",
        description: x?.sourceCommonName || "",
        url: normalizeUrl(x?.url || ""),
        source: x?.sourceCommonName || "GDELT",
        publishedAt: toISOorEmpty(x?.seendate)
      });
    }
  }
  return out;
}

export async function runNewsSyncRange(fromISO, toISO){
  const candidates = await gdeltRange(fromISO, toISO);

  // normalize
  const normalized = heuristicNormalize(candidates);

  // persist
  const database = db();
  ensureNewsTable(database);
  const insert = database.prepare(`
    INSERT OR IGNORE INTO news_items
    (id, person_name, role, email, company, city, url, source, published_at, month_label, category, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let kept = 0, roleChanges = 0, achievements = 0;
  for (const r of normalized){
    const iso = r.publishedAt && toISOorEmpty(r.publishedAt) ? toISOorEmpty(r.publishedAt) : nowISO();
    const company = String(r.company || "").trim();
    const role = String(r.role || "").trim();
    const cat = r.category === "Achievement" ? "Achievement" : "Role Change";
    if (!company || !role) continue;
    insert.run(
      cuid(), String(r.person_name || ""), role, "",
      company, String(r.city || ""),
      String(normalizeUrl(r.url || "")),
      String(r.source || ""),
      iso, monthLabelFromISO(iso), cat, nowISO()
    );
    kept++; if (cat === "Role Change") roleChanges++; else achievements++;
  }
  return { ok: true, fetched: candidates.length, kept, role_changes: roleChanges, achievements };
}
