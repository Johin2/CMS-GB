import { NextResponse } from "next/server";
import { marketingTick, ensureMarketingSchema } from "@lib/marketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    ensureMarketingSchema();
    const url = new URL(req.url);
    const batch = Math.max(1, Math.min(200, Number(url.searchParams.get("batch") || 50)));
    const stats = await marketingTick({ batch });
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || "tick failed") }, { status: 500 });
  }
}
