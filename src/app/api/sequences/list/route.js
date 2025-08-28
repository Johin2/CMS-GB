// src/app/api/sequences/list/route.js
import { NextResponse } from "next/server";
import { db } from "../../../lib/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const database = db();
    const sequences = database
      .prepare(`SELECT id, name, description, created_at FROM sequences ORDER BY name`)
      .all();

    const steps = database
      .prepare(`
        SELECT s.id as sequence_id, s.name, st.step_order, st.subject, st.body, st.created_at
        FROM sequence_steps st
        JOIN sequences s ON s.id = st.sequence_id
        ORDER BY s.name, st.step_order
      `)
      .all();

    return NextResponse.json({ sequences, steps });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "list failed" }, { status: 500 });
  }
}
