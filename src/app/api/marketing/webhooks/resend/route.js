import { NextResponse } from "next/server";
import { db } from "../../../../lib/sqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const payload = await req.json().catch(() => ({}));
    // Expect something like: { type: "email.delivered", data: { id: "...", to: "...", ... } }
    const type = payload?.type || "";
    const data = payload?.data || {};

    const statusMap = {
      "email.sent": "sent",
      "email.delivered": "delivered",
      "email.opened": "opened",
      "email.clicked": "clicked",
      "email.bounced": "bounced",
      "email.complained": "complained"
    };
    const status = statusMap[type] || null;

    const d = db();
    if (status && data?.id) {
      d.prepare(`
        UPDATE marketing_sends
        SET status = ?, updated_at = datetime('now')
        WHERE provider = 'resend' AND provider_id = ?
      `).run(status, data.id);

      // if bounce/complaint, suppress future sends for the contact
      if (status === "bounced" || status === "complained") {
        const row = d.prepare(`
          SELECT contact_id FROM marketing_sends WHERE provider = 'resend' AND provider_id = ? LIMIT 1
        `).get(data.id);
        if (row?.contact_id) {
          d.prepare(`
            INSERT INTO marketing_suppressions (id, contact_id, reason, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).run(crypto.randomUUID?.() || String(Date.now()), row.contact_id, status);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || "webhook failed") }, { status: 500 });
  }
}
