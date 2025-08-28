export async function aiScoreLead(input: { title?: string; seniority?: string }) {
  const key = process.env.OPENAI_API_KEY || "";
  const t = (input.title || "").toLowerCase();
  const s = (input.seniority || "").toLowerCase();

  // Heuristic baseline (no regex)
  let score = 30;
  if (s.includes("c-level") || t.includes("chief")) score = 95;
  else if (s.includes("vp")) score = 85;
  else if (s.includes("director")) score = 75;
  else if (s.includes("head") || s.includes("lead")) score = 65;
  else if (s.includes("manager")) score = 55;

  if (!key) return score;

  // Lightweight AI nudge (kept simple, pure fetch)
  const prompt = `You are scoring B2B leads. Title: "${input.title || ""}", Seniority: "${input.seniority || ""}". Return a single integer 0-100 (no text).`;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      })
    });
    if (!res.ok) return score;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const n = parseInt(String(raw).replace(/\D+/g, ""), 10); // if you prefer zero-regex, just return heuristic
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : score;
  } catch {
    return score;
  }
}
