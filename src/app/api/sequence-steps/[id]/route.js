import { NextResponse } from "next/server";
import { db } from "../../../lib/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req, { params }) {
  try {
    const { id } = params || {};
    const database = db();

    const step = database.prepare(`SELECT * FROM sequence_steps WHERE id = ?`).get(id);
    if (!step) return NextResponse.json({ error: "not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const subject = body?.subject != null ? String(body.subject) : undefined;
    const content = body?.body != null ? String(body.body) : undefined;
    const stepOrder = body?.step_order != null ? Number(body.step_order) : undefined;

    if (subject !== undefined) {
      database.prepare(`UPDATE sequence_steps SET subject = ? WHERE id = ?`).run(subject, id);
    }
    if (content !== undefined) {
      database.prepare(`UPDATE sequence_steps SET body = ? WHERE id = ?`).run(content, id);
    }
    if (stepOrder !== undefined) {
      database.prepare(`UPDATE sequence_steps SET step_order = ? WHERE id = ?`).run(stepOrder, id);
    }

    const saved = database.prepare(`
      SELECT id, sequence_id, step_order, subject, body, created_at
      FROM sequence_steps WHERE id = ?
    `).get(id);

    return NextResponse.json({ ok: true, step: saved });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "update failed" }, { status: 500 });
  }
}

export async function DELETE(_req, { params }) {
  try {
    const { id } = params || {};
    const database = db();

    const step = database.prepare(`SELECT id FROM sequence_steps WHERE id = ?`).get(id);
    if (!step) return NextResponse.json({ error: "not found" }, { status: 404 });

    database.prepare(`DELETE FROM sequence_steps WHERE id = ?`).run(id);
    return NextResponse.json({ ok: true, deleted: id });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "delete failed" }, { status: 500 });
  }
}
