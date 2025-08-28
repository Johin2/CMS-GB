// src/app/api/cron/relationships-monthly/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, nowISO, cuid } from "@lib/sqlite"; // adjust path alias if needed

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req) {
  try {
    const database = db();

    // 1) Look up the "Relationships" segment
    const segment = database
      .prepare(`SELECT * FROM segments WHERE name = ?`)
      .get("Relationships");
    if (!segment) {
      return NextResponse.json(
        { error: "Segment 'Relationships' not found" },
        { status: 404 }
      );
    }

    // 2) Find sequence and first step
    const sequence = database
      .prepare(`SELECT * FROM sequences WHERE name = ?`)
      .get("Relationships - CEOs");
    if (!sequence) {
      return NextResponse.json(
        { error: "Sequence 'Relationships - CEOs' not found" },
        { status: 404 }
      );
    }

    const step1 = database
      .prepare(
        `SELECT * FROM sequence_steps WHERE sequence_id = ? AND step_order = 1`
      )
      .get(sequence.id);
    if (!step1) {
      return NextResponse.json({ error: "Step 1 not found" }, { status: 404 });
    }

    // 3) Companies in the segment
    const companies = database
      .prepare(`SELECT company_id FROM company_segments WHERE segment_id = ?`)
      .all(segment.id);

    // 4) Prepare statements
    const selectCEOs = database.prepare(
      `SELECT id, email
         FROM contacts
        WHERE company_id = ?
          AND role = 'CEO'
          AND email IS NOT NULL`
    );

    const insertQueue = database.prepare(
      `INSERT INTO email_queue
        (id, contact_id, sequence_id, step_id, status, scheduled_at, created_at, updated_at)
       VALUES
        (?,  ?,         ?,          ?,      'queued', ?,            ?,         ?)`
    );

    // 5) Enqueue for all CEOs
    let enqueued = 0;
    const now = nowISO();

    for (const row of companies) {
      const ceos = selectCEOs.all(row.company_id);
      for (const c of ceos) {
        insertQueue.run(cuid(), c.id, sequence.id, step1.id, now, now, now);
        enqueued++;
      }
    }

    return NextResponse.json({ enqueued });
  } catch (e) {
    return NextResponse.json(
      { error: e?.message || "enqueue failed" },
      { status: 500 }
    );
  }
}
