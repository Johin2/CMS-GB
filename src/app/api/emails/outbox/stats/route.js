// src/app/api/emails/outbox/stats/route.js
import { NextResponse } from "next/server";
import { db } from "../../../../lib/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ensureOutboxTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS emails_outbox (
      id          TEXT PRIMARY KEY,
      to_email    TEXT,
      subject     TEXT,
      body        TEXT,        -- can be HTML or text
      provider    TEXT,        -- 'resend' | 'mock'
      provider_id TEXT,
      status      TEXT,        -- 'queued' | 'sent' | 'failed'
      created_at  TEXT,
      updated_at  TEXT,
      meta        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_status  ON emails_outbox(status);
    CREATE INDEX IF NOT EXISTS idx_outbox_created ON emails_outbox(created_at);
  `);
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const range = (url.searchParams.get("range") || "7d").toLowerCase();
    const days = range === "30d" ? 30 : 7;

    const database = db();
    ensureOutboxTable(database);

    const totals = database.prepare(`
      SELECT
        COUNT(*)                                                       AS total,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END)            AS queued,
        SUM(CASE WHEN status = 'sent'   THEN 1 ELSE 0 END)            AS sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)            AS failed
      FROM emails_outbox
    `).get();

    const sinceISO = new Date(Date.now() - (days - 1) * 86400000).toISOString();
    const per = database.prepare(`
      SELECT substr(created_at, 1, 10) AS d,
             COUNT(*) AS emails,
             SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent
      FROM emails_outbox
      WHERE created_at >= ?
      GROUP BY d
      ORDER BY d ASC
    `).all(sinceISO);

    return NextResponse.json({
      ok: true,
      total: totals?.total || 0,
      queued: totals?.queued || 0,
      sent: totals?.sent || 0,
      failed: totals?.failed || 0,
      per_day: (per || []).map(r => ({ date: r.d, emails: r.emails, sent: r.sent })),
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "stats failed" }, { status: 500 });
  }
}
