import { NextResponse } from "next/server";
import { ensureMarketingSchema, createCampaign, listCampaigns } from "../../../lib/marketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ensureMarketingSchema();
    const data = listCampaigns();
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || "list failed") }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    ensureMarketingSchema();
    const body = await req.json().catch(() => ({}));
    const { name, description = "", steps = [] } = body || {};
    if (!name) return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });

    const created = createCampaign({ name, description, steps });
    return NextResponse.json({ ok: true, campaign: created });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || "create failed") }, { status: 500 });
  }
}
