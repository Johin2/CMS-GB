// src/app/api/emails/outbox/import/route.js
import { NextResponse } from "next/server";
import { db, cuid, nowISO } from "../../../../lib/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ensureOutboxTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS emails_outbox (
      id          TEXT PRIMARY KEY,
      to_email    TEXT,
      subject     TEXT,
      body        TEXT,
      provider    TEXT,
      provider_id TEXT,
      status      TEXT,
      created_at  TEXT,
      updated_at  TEXT,
      meta        TEXT
    );
  `);
}

async function sendWithResend({ from, to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !from) return { ok: false, provider: "mock", id: null, status: "queued" };

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  if (!r.ok) {
    const err = await r.text().catch(() => "");
    return { ok: false, provider: "resend", id: null, status: "queued", error: err };
  }
  const data = await r.json().catch(() => ({}));
  return { ok: true, provider: "resend", id: data?.id || null, status: "sent" };
}

export async function POST(req) {
  try {
    const database = db();
    ensureOutboxTable(database);

    const body = await req.json().catch(() => ({}));
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const send = !!body?.send;

    const defSubject = String(body?.default_subject || "").trim();
    const defHtml    = String(body?.default_html || "").trim();
    const defText    = String(body?.default_text || "").trim();

    if (rows.length === 0) {
      return NextResponse.json({ error: "rows required" }, { status: 400 });
    }

    const now = nowISO();
    let inserted = 0, queued = 0, sent = 0, failed = 0;

    for (const r of rows) {
      const to = String(r.email || r.to || r.to_email || "").trim().toLowerCase();
      if (!to || !to.includes("@")) continue;

      const subject = String(r.subject || defSubject || "(no subject)");
      const html = String(r.html || r.body_html || defHtml || "");
      const text = String(r.text || r.body_text || defText || (html ? html.replace(/<[^>]+>/g, " ") : ""));

      let provider = "mock", provider_id = null, status = "queued";

      if (send) {
        const from = process.env.RESEND_FROM || null;
        const s = await sendWithResend({ from, to, subject, html, text });
        provider = s.provider;
        provider_id = s.id;
        status = s.status;
        if (status === "sent") sent++; else queued++;
        if (!s.ok && s.provider === "resend") failed++;
      } else {
        queued++;
      }

      database.prepare(`
        INSERT INTO emails_outbox
          (id, to_email, subject, body, provider, provider_id, status, created_at, updated_at, meta)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cuid(),
        to,
        subject,
        html || text,
        provider,
        provider_id,
        status,
        now,
        now,
        JSON.stringify({ source: "csv" })
      );

      inserted++;
    }

    return NextResponse.json({ ok: true, inserted, queued, sent, failed });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "import failed" }, { status: 500 });
  }
}
