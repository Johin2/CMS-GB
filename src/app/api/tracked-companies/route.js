import { NextResponse } from "next/server";
import { db, nowISO, cuid } from "@lib/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const items = db()
      .prepare(
        `SELECT id, name, domain, active, created_at, updated_at, last_synced_at
         FROM tracked_companies
         ORDER BY created_at DESC`
      )
      .all();
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = (await req.json().catch(() => ({})));
    const domain = String(body?.domain || "").toLowerCase().trim();
    const name = body?.name ? String(body.name) : null;
    if (!domain) return NextResponse.json({ error: "domain required" }, { status: 400 });

    const database = db();
    const existing = database
      .prepare(`SELECT id FROM tracked_companies WHERE domain = ?`)
      .get(domain);

    const now = nowISO();

    if (existing) {
      database
        .prepare(
          `UPDATE tracked_companies
             SET name = COALESCE(?, name),
                 active = 1,
                 updated_at = ?
           WHERE id = ?`
        )
        .run(name, now, existing.id);

      const item = database
        .prepare(
          `SELECT id, name, domain, active, created_at, updated_at, last_synced_at
             FROM tracked_companies
            WHERE id = ?`
        )
        .get(existing.id);
      return NextResponse.json(item, { status: 200 });
    } else {
      const id = cuid();
      database
        .prepare(
          `INSERT INTO tracked_companies (id, domain, name, active, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`
        )
        .run(id, domain, name, now, now);

      const item = database
        .prepare(
          `SELECT id, name, domain, active, created_at, updated_at, last_synced_at
             FROM tracked_companies
            WHERE id = ?`
        )
        .get(id);
      return NextResponse.json(item, { status: 201 });
    }
  } catch (e) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
