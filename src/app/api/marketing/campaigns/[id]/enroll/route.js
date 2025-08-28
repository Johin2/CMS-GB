import { NextResponse } from "next/server";
import { enrollContacts, ensureMarketingSchema } from "../../../../lib/marketing";
import { db } from "../../../../lib/sqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  try {
    ensureMarketingSchema();
    const id = params?.id;
    if (!id) return NextResponse.json({ ok: false, error: "campaign id required" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const { contactIds = [], startAtISO = null } = body || {};
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return NextResponse.json({ ok: false, error: "contactIds required" }, { status: 400 });
    }

    // optional: verify contacts exist & active
    const d = db();
    const q = d.prepare(`SELECT id FROM contacts WHERE id IN (${contactIds.map(() => "?").join(",")}) AND is_active = 1`);
    const okIds = q.all(...contactIds).map(r => r.id);
    if (okIds.length === 0) return NextResponse.json({ ok: false, error: "no valid contacts" }, { status: 400 });

    const res = enrollContacts({ campaignId: id, contactIds: okIds, startAtISO });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || "enroll failed") }, { status: 500 });
  }
}
