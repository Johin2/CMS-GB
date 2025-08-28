import { NextResponse } from "next/server";
import { db } from "../../../lib/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req, { params }) {
  try {
    const { id } = params || {};
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const name = body?.name != null ? String(body.name).trim() : undefined;
    const description = body?.description != null ? String(body.description) : undefined;

    const database = db();
    const row = database.prepare(`SELECT id FROM sequences WHERE id = ?`).get(id);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

    if (name !== undefined) {
      database.prepare(`UPDATE sequences SET name = ? WHERE id = ?`).run(name, id);
    }
    if (description !== undefined) {
      database.prepare(`UPDATE sequences SET description = ? WHERE id = ?`).run(description, id);
    }

    const saved = database.prepare(`SELECT id, name, description, created_at FROM sequences WHERE id = ?`).get(id);
    return NextResponse.json({ ok: true, sequence: saved });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "update failed" }, { status: 500 });
  }
}

export async function DELETE(_req, { params }) {
  try {
    const { id } = params || {};
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

    const database = db();
    const row = database.prepare(`SELECT id FROM sequences WHERE id = ?`).get(id);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

    database.exec("BEGIN");
    try {
      database.prepare(`DELETE FROM sequence_steps WHERE sequence_id = ?`).run(id);
      database.prepare(`DELETE FROM sequences WHERE id = ?`).run(id);
      database.exec("COMMIT");
    } catch (e) {
      database.exec("ROLLBACK");
      throw e;
    }
    return NextResponse.json({ ok: true, deleted: id });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "delete failed" }, { status: 500 });
  }
}
