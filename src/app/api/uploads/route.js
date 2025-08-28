import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { cuid } from "@lib/sqlite"; // you already have cuid there

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const orig = String(file.name || "upload.bin");
    const safeName = orig.replace(/[^\w.-]+/g, "_");
    const ext = path.extname(safeName) || ".bin";
    const id = cuid();
    const filename = `${id}${ext}`;

    // Save inside /public/uploads so it’s web-accessible
    const publicDir = path.join(process.cwd(), "public", "uploads");
    await fs.mkdir(publicDir, { recursive: true });
    const outPath = path.join(publicDir, filename);
    await fs.writeFile(outPath, bytes);

    const origin = req.nextUrl?.origin || "";
    const url = `${origin}/uploads/${filename}`;
    return NextResponse.json({ ok: true, url, name: safeName, size: bytes.length });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "upload failed" }, { status: 500 });
  }
}
