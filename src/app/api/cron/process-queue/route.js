import { NextResponse } from "next/server";
import { db, nowISO, cuid } from "../../../lib/sqlite";
import { sendEmailViaResend } from "../../../lib/email";
import { fillTokens } from "../../../lib/tokens";

export const runtime = "nodejs";       // Resend SDK requires Node runtime
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const database = db();
    const now = nowISO();

    const due = database
      .prepare(`
        SELECT
          q.id as q_id, q.status, q.scheduled_at,
          c.id as c_id, c.email as c_email, c.first_name, c.company as c_company,
          co.name as co_name, co.industry as co_industry,
          s.subject as step_subject, s.body as step_body
        FROM email_queue q
        JOIN contacts c ON c.id = q.contact_id
        JOIN sequence_steps s ON s.id = q.step_id
        LEFT JOIN companies co ON co.id = c.company_id
        WHERE q.status = 'queued' AND (q.scheduled_at IS NULL OR q.scheduled_at <= ?)
      `)
      .all(now);

    let sent = 0, failed = 0;

    const mark = database.prepare(
      `UPDATE email_queue SET status = ?, updated_at = ? WHERE id = ?`
    );
    const insertInteraction = database.prepare(`
      INSERT INTO interactions (id, contact_id, type, created_at, meta)
      VALUES (?, ?, ?, ?, ?)
    `);

    // Reuse month/year across loop
    const nowDate = new Date();
    const month = nowDate.toLocaleString("en-US", { month: "long" });
    const year = String(nowDate.getFullYear());

    for (const row of due) {
      try {
        if (!row.c_email) throw new Error("Contact has no email");

        const companyName = row.co_name || row.c_company || "";
        const vars = {
          first_name: row.first_name,
          company: companyName,
          category: row.co_industry || "",
          month,
          year,
          sender_name: "Your Name",
        };

        mark.run("sending", nowISO(), row.q_id);

        const subject = fillTokens(row.step_subject, vars);
        const html = `<pre style="font-family: ui-sans-serif, system-ui">${fillTokens(row.step_body, vars)}</pre>`;

        // Uses @lib/email -> Resend SDK (env: RESEND_API_KEY, RESEND_FROM)
        const providerRes = await sendEmailViaResend({
          to: row.c_email,
          subject,
          html,
        });

        mark.run("sent", nowISO(), row.q_id);

        insertInteraction.run(
          cuid(),
          row.c_id,
          "SENT",
          nowISO(),
          JSON.stringify({ queueId: row.q_id, providerRes })
        );

        sent++;
      } catch (e) {
        database
          .prepare(
            `UPDATE email_queue SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`
          )
          .run(String(e?.message || e), nowISO(), row.q_id);
        failed++;
      }
    }

    return NextResponse.json({ processed: due.length, sent, failed });
  } catch (e) {
    return NextResponse.json(
      { error: e?.message || "process-queue failed" },
      { status: 500 }
    );
  }
}
