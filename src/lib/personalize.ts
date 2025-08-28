// src/lib/personalize.ts
type Person = {
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  title?: string | null;
  seniority?: string | null;
  linkedinUrl?: string | null;
};

type Company = { name?: string | null; domain?: string | null; industry?: string | null };

type Snippet = { title: string; source: string; url?: string; date?: string };
type GenerateInput = {
  person: Person;
  company: Company;
  roleHint?: string;           // "CEO" | "CMO" | "CPO" | "CTO" | etc.
  offering?: string;           // your value prop, one-liner
  proof?: string[];            // facts like “15+ years”, “1000+ adfilms”
  achievements?: Snippet[];    // if you already have curated wins
  tone?: "concise" | "warm" | "formal";
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const NEWS_API_KEY = process.env.NEWS_API_KEY || ""; // optional (newsapi.org)

function roleAngle(role: string) {
  const r = role.toLowerCase();
  if (r.includes("ceo"))   return "strategic outcomes, compounding results, peers, board-level clarity";
  if (r.includes("cmo"))   return "brand impact, media/production efficiency, speed-to-campaign, creative quality";
  if (r.includes("cpo"))   return "product launches, GTM alignment with brand, cross-funct velocity";
  if (r.includes("cto"))   return "workflow tooling, reliability, vendor efficiency, measurable ROI";
  if (r.includes("cfo"))   return "budget discipline, predictability, cost-to-value, risk mitigation";
  return "clear ROI, next steps, low time ask";
}

async function fetchCompanyNews(domain?: string | null, name?: string | null): Promise<Snippet[]> {
  if (!NEWS_API_KEY) return [];
  const q = name ? encodeURIComponent(name) : (domain || "");
  const url = `https://newsapi.org/v2/everything?q=${q}&pageSize=5&sortBy=publishedAt&language=en&apiKey=${NEWS_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const articles = Array.isArray(data?.articles) ? data.articles : [];
    return articles.map((a: any) => ({
      title: String(a.title || ""),
      source: String(a.source?.name || "News"),
      url: String(a.url || ""),
      date: String(a.publishedAt || "")
    }));
  } catch {
    return [];
  }
}

function compactSnippets(items: Snippet[], max = 3) {
  const out: Snippet[] = [];
  for (const it of items) {
    if (!it || !it.title) continue;
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

export async function generatePersonalizedEmail(input: GenerateInput) {
  const { person, company, roleHint, tone = "concise" } = input;

  const role = roleHint || (person.title || input.person.seniority || "");
  const angle = roleAngle(role);

  // Optionally enrich with recent articles
  const news = input.achievements?.length
    ? compactSnippets(input.achievements)
    : await fetchCompanyNews(company.domain, company.name);

  const achievements = news.map((n) => `${n.title}${n.source ? ` — ${n.source}` : ""}`);

  const offering =
    input.offering ||
    "Glassbox Production Advisory helps brands extract more value from film/production budgets without quality trade-offs.";

  const proof = input.proof?.length ? input.proof : [
    "15+ years of experience",
    "1000+ adfilms optimised",
    "10–20% savings delivered"
  ];

  const you = [person.firstName, person.lastName].filter(Boolean).join(" ").trim() || "there";
  const companyName = company.name || company.domain || "your team";

  const messages = [
    {
      role: "system",
      content:
        "You write concise, human emails for B2B outreach. Avoid hype. 90–140 words. British/neutral punctuation acceptable. No emojis."
    },
    {
      role: "user",
      content: [
        `Recipient: ${you} (${role}) at ${companyName} (${company.domain || ""})`,
        `Angle for role: ${angle}`,
        `Offering: ${offering}`,
        `Proof points: ${proof.join(" • ")}`,
        achievements.length ? `Recent wins to reference:\n- ${achievements.join("\n- ")}` : "No recent wins available.",
        `Tone: ${tone}`,
        "Output JSON with keys: subject, preview, bodyHtml. bodyHtml must be simple HTML (p, strong, a) suitable for email.",
        "CTA: suggest a short 15-minute call next week with two time options.",
      ].join("\n")
    }
  ];

  if (!OPENAI_API_KEY) {
    // Fallback if no key: generic but role-aware
    const subject = `${companyName}: quick idea on ${role.toLowerCase()}`;
    const preview = `How peers are getting more film per film — in 15 minutes.`;
    const bodyHtml =
      `<p>Hi ${person.firstName || "there"},</p>
       <p>Noticed ${companyName}${achievements.length ? `’s recent ${achievements[0]}` : ""}. We help teams get <strong>more film per film</strong> — same creative quality, tighter production and measurable ROI.</p>
       <p>Why this matters for ${role.split(" ")[0]}s: ${angle}.</p>
       <p>Proof: ${proof.join(" • ")}.</p>
       <p>Open to a quick 15-minute chat next week? Tue 11:00 or Thu 15:00 works for me.</p>
       <p>— Your Name</p>`;
    return { subject, preview, bodyHtml };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: 0.3 })
  });

  const data = await res.json().catch(() => ({}));
  const raw = data?.choices?.[0]?.message?.content || "";

  // Parse JSON without regex: find first "{" and last "}" and JSON.parse
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  let subject = `${companyName}: quick idea`;
  let preview = "Short intro about improving production ROI.";
  let bodyHtml = `<p>Hi ${you},</p><p>We help brands get more film per film. Open to a quick 15-minute chat next week?</p><p>— Your Name</p>`;
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const obj = JSON.parse(raw.slice(start, end + 1));
      subject = String(obj.subject || subject);
      preview = String(obj.preview || preview);
      bodyHtml = String(obj.bodyHtml || bodyHtml);
    } catch {/* fall back */}
  }
  return { subject, preview, bodyHtml };
}
