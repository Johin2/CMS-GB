// src/app/api/sequences/seed/route.js
import { NextResponse } from "next/server";
import { db, cuid, nowISO } from "../../../../lib/sqlite";

// Tolerant import: if the module or export is missing, we'll fallback below.
let TPL = {};
try {
  // If your alias is different, adjust this line.
  TPL = (await import("@lib/templates")).DEFAULT_TEMPLATES || {};
} catch (_) {
  // ignore; we'll use in-file fallbacks
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Ensure sequences schema exists */
function ensureSequencesSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sequences (
      id          TEXT PRIMARY KEY,
      name        TEXT UNIQUE,
      description TEXT,
      created_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS sequence_steps (
      id           TEXT PRIMARY KEY,
      sequence_id  TEXT,
      step_order   INTEGER,
      subject      TEXT,
      body         TEXT,
      created_at   TEXT,
      UNIQUE(sequence_id, step_order)
    );

    CREATE INDEX IF NOT EXISTS idx_sequence_steps_seq ON sequence_steps(sequence_id);
  `);
}

/** Tiny helper to choose template safely */
function fallback(subj, body, src) {
  return {
    subject: (src && src.subject) || subj,
    body: (src && src.body) || body,
  };
}

export async function GET() {
  try {
    const database = db();
    ensureSequencesSchema(database); // <-- important
    const now = nowISO();

    // Prepare statements
    const selSeq = database.prepare(`SELECT id FROM sequences WHERE name = ?`);
    const insSeq = database.prepare(`
      INSERT INTO sequences (id, name, description, created_at)
      VALUES (?, ?, ?, ?)
    `);
    const updSeq = database.prepare(`
      UPDATE sequences SET description = COALESCE(?, description) WHERE id = ?
    `);

    function ensureSequence(name, description) {
      const row = selSeq.get(name);
      if (row?.id) {
        updSeq.run(description, row.id);
        return row.id;
      }
      const id = cuid();
      insSeq.run(id, name, description, now);
      return id;
    }

    const selStep = database.prepare(`
      SELECT id FROM sequence_steps WHERE sequence_id = ? AND step_order = ?
    `);
    const insStep = database.prepare(`
      INSERT INTO sequence_steps (id, sequence_id, step_order, subject, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const updStep = database.prepare(`
      UPDATE sequence_steps SET subject = ?, body = ? WHERE id = ?
    `);

    function ensureStep(seqId, stepOrder, subject, body) {
      const row = selStep.get(seqId, stepOrder);
      if (row?.id) {
        updStep.run(subject, body, row.id);
        return row.id;
      }
      const id = cuid();
      insStep.run(id, seqId, stepOrder, subject, body, now);
      return id;
    }

    // Templates (use provided module if available, else fallback)
    const rel = fallback(
      "Monthly update: how {{company}} is compounding results",
      `Hi {{first_name}},

Quick one-pager on what we shipped in {{month}} and the outcomes for peers in {{category}}.
If helpful, we can brief your leadership on “what great looks like” this quarter.

— {{sender_name}}`,
      TPL.RELATIONSHIPS_MONTHLY_CEO
    );

    const cmo = fallback(
      "Congrats on the new role, {{first_name}} — fast wins in {{category}}",
      `Hi {{first_name}}, congrats on joining {{company}}.

We mapped {{category}} innovations in India & globally and overlaid them with your past work.
Happy to share a 90-day roadmap tailored to {{company}}.

— {{sender_name}}`,
      TPL.NEW_CMO_INITIAL
    );

    // Ensure sequences + step1
    const seqAId = ensureSequence("Relationships - CEOs", "Monthly relationship touch for CEOs");
    const stepA1Id = ensureStep(seqAId, 1, rel.subject, rel.body);

    const seqBId = ensureSequence("New CMO Initial", "First-touch note for newly appointed CMOs");
    const stepB1Id = ensureStep(seqBId, 1, cmo.subject, cmo.body);

    // Snapshot for UI
    const sequences = database.prepare(
      `SELECT id, name, description, created_at FROM sequences ORDER BY name`
    ).all();
    const steps = database.prepare(
      `SELECT s.name, st.step_order, st.subject
         FROM sequence_steps st
         JOIN sequences s ON s.id = st.sequence_id
        ORDER BY s.name, st.step_order`
    ).all();

    return NextResponse.json({
      ok: true,
      ensured: {
        "Relationships - CEOs": { step1: stepA1Id },
        "New CMO Initial": { step1: stepB1Id },
      },
      sequences,
      steps,
    });
  } catch (e) {
    // Always return JSON so the client’s res.json() doesn’t blow up
    return NextResponse.json(
      { ok: false, error: String(e?.message || "seed failed") },
      { status: 500 }
    );
  }
}
