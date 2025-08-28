import { NextResponse } from "next/server";
import { db, cuid, nowISO } from "../../../lib/sqlite";
import { fillTokens } from "../../../lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------ helpers ------------ */
function looksLikeHTML(s) {
  const t = String(s || "").trim();
  if (!t) return false;
  if (t.toLowerCase().startsWith("<!doctype html")) return true;
  // simple heuristic: contains a tag pair or <html|head|body|table|div|p>
  return /<\/?[a-z][\s\S]*>/i.test(t);
}

function htmlToText(html) {
  let t = String(html || "");
  // drop script & style blocks
  t = t.replace(/<script[\s\S]*?<\/script>/gi, "");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, "");
  // break on block tags
  t = t.replace(/<\/(p|div|h\d|li|tr|table|section|article|br)>/gi, "$&\n");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  // strip all tags
  t = t.replace(/<\/?[^>]+>/g, "");
  // decode a couple common entities
  t = t.replace(/&nbsp;/g, " ")
       .replace(/&amp;/g, "&")
       .replace(/&lt;/g, "<")
       .replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'");
  // collapse whitespace
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

function textToBasicHTML(text) {
  const esc = String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc.replace(/\n/g, "<br/>");
}

async function sendWithResend({ from, to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !from) {
    // mock/queue if not configured
    return { ok: false, provider: "mock", id: null, status: "queued" };
  }

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  if (!r.ok) {
    const err = await r.text().catch(() => "");
    return { ok: false, provider: "resend", id: null, status: "queued", error: err };
  }
  const data = await r.json().catch(() => ({}));
  return { ok: true, provider: "resend", id: data?.id || null, status: "sent" };
}

/* ------------ POST ------------ */
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));

    // NEW: optional html_override to bypass the sequence body for one-off HTML sends
    const {
      sequenceName,
      stepOrder = 1,
      email,
      use_ai = false,
      vars = {},
      html_override, // string | optional
      subject_override, // optional
    } = body;

    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
    if (!sequenceName && !html_override) {
      return NextResponse.json({ error: "sequenceName or html_override is required" }, { status: 400 });
    }

    const database = db();

    let subject = subject_override || "";
    let bodyTemplate = "";

    if (sequenceName) {
      const step = database.prepare(`
        SELECT st.subject, st.body
        FROM sequence_steps st
        JOIN sequences s ON s.id = st.sequence_id
        WHERE s.name = ? AND st.step_order = ?
      `).get(sequenceName, stepOrder);

      if (!step) {
        return NextResponse.json({ error: "Sequence or step not found" }, { status: 404 });
      }
      subject = subject || step.subject || "";
      bodyTemplate = step.body || "";
    }

    // choose template: html_override (if provided) or step body
    const templateToUse = html_override ?? bodyTemplate;

    // fill tokens
    const filledSubject = fillTokens(subject || "", vars);
    const filledBodyRaw = fillTokens(templateToUse || "", vars);

    // decide html/text
    const isHTML = looksLikeHTML(filledBodyRaw);
    const html = isHTML ? filledBodyRaw : textToBasicHTML(filledBodyRaw);
    const text = isHTML ? htmlToText(filledBodyRaw) : filledBodyRaw;

    const from = process.env.RESEND_FROM || null;

    const sendResult = await sendWithResend({
      from,
      to: email,
      subject: filledSubject,
      html,
      text,
    });

    // store an outbox/history row
    const now = nowISO();
    database.prepare(`
      INSERT INTO emails_outbox
        (id, to_email, subject, body, provider, provider_id, status, created_at, updated_at, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cuid(),
      email,
      filledSubject,
      // store the HTML we actually sent (helps preview later)
      html,
      sendResult.provider,
      sendResult.id,
      sendResult.status,
      now,
      now,
      JSON.stringify({
        sequence: sequenceName || null,
        step_order: stepOrder,
        used_ai: !!use_ai,
        is_html: isHTML || !!html_override,
      })
    );

    return NextResponse.json({
      ok: true,
      to: email,
      sequence: sequenceName || null,
      step_order: sequenceName ? stepOrder : null,
      subject: filledSubject,
      used_ai: !!use_ai,
      provider: sendResult.provider,
      status: sendResult.status,
      sent_email_id: sendResult.id,
      is_html: isHTML || !!html_override,
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "send failed" }, { status: 500 });
  }
}
