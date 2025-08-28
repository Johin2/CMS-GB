import { NextResponse } from "next/server";
import { db, cuid, nowISO } from "../../../../lib/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ensureTables(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sequences (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE,
      description TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sequence_steps (
      id TEXT PRIMARY KEY,
      sequence_id TEXT,
      step_order INTEGER,
      subject TEXT,
      body TEXT,
      created_at TEXT,
      UNIQUE(sequence_id, step_order)
    );
  `);
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const withSteps = url.searchParams.get("withSteps") === "1";

    const database = db();
    ensureTables(database);

    const seqs = database.prepare(`
      SELECT s.id, s.name, s.description, s.created_at,
             (SELECT COUNT(*) FROM sequence_steps st WHERE st.sequence_id = s.id) AS step_count
      FROM sequences s ORDER BY s.name
    `).all();

    if (!withSteps) {
      return NextResponse.json({ sequences: seqs });
    }

    const steps = database.prepare(`
      SELECT id, sequence_id, step_order, subject, body, created_at
      FROM sequence_steps
    `).all();

    const bySeq = {};
    for (const s of seqs) bySeq[s.id] = { ...s, steps: [] };
    for (const st of steps) {
      if (bySeq[st.sequence_id]) bySeq[st.sequence_id].steps.push(st);
    }
    return NextResponse.json({ sequences: Object.values(bySeq) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "list failed" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const database = db();
    ensureTables(database);

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name || "").trim();
    const description = body?.description ? String(body.description) : null;
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    const now = nowISO();
    const id = cuid();
    database.prepare(`
      INSERT INTO sequences (id, name, description, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, name, description, now);

    return NextResponse.json({ ok: true, sequence: { id, name, description, created_at: now } });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "create failed" }, { status: 500 });
  }
}
