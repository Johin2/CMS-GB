// src/app/api/url-status/route.js
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/url-status?u=<encoded URL>
 * Returns: { ok: boolean, status: number }
 */
export async function GET(req) {
  const url = new URL(req.url);
  const target = url.searchParams.get("u");
  if (!target) {
    return NextResponse.json({ ok: false, status: 0, error: "Missing ?u=" }, { status: 400 });
  }
  try {
    // Try HEAD first (cheap). If blocked, fall back to GET.
    let res = await fetch(target, { method: "HEAD", redirect: "follow", cache: "no-store" });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(target, { method: "GET", redirect: "follow", cache: "no-store" });
    }
    return NextResponse.json({ ok: res.ok, status: res.status });
  } catch (e) {
    return NextResponse.json({ ok: false, status: 0, error: String(e?.message || e) });
  }
}
