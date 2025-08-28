// src/app/api/cron/leads-weekly/route.ts
import { NextResponse } from "next/server";
import { db, cuid, nowISO } from "../../../../lib/sqlite";
import { fetchApolloLeadsByDomain } from "../../../../lib/apollo";
import { aiScoreLead } from "../../../../lib/ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// shallow equality helper (no regex)
function changed(a, b) {
  return a !== b && (a || b);
}

// rank seniority for simple promotion detection
function rank(s) {
  const t = (s || "").toLowerCase();
  if (t.includes("c-level") || t.includes("chief")) return 5;
  if (t.includes("vp")) return 4;
  if (t.includes("director")) return 3;
  if (t.includes("head") || t.includes("lead")) return 2;
  if (t.includes("manager")) return 1;
  return 0;
}

async function upsertContactFromLead(lead) {
  const database = db();
  const selByEmail = database.prepare(`SELECT * FROM contacts WHERE email = ?`);
  const existing = selByEmail.get(lead.email);

  const now = nowISO();

  if (!existing) {
    const id = cuid();
    const ins = database.prepare(`
      INSERT INTO contacts
        (id, email, first_name, last_name, phone, title, company, company_domain,
         linkedin_url, seniority, source, role, is_active, first_seen_at, last_seen_at, last_synced_at, created_at)
      VALUES
        (?,  ?,     ?,          ?,        ?,     ?,     ?,       ?, 
         ?,            ?,        ?,     ?,    1,         ?,           ?,           ?,             ?)
    `);

    // naive role guess from seniority/title
    const title = lead.title || "";
    const sen = (lead.seniority || "");
    const guessRole =
      title.toLowerCase().includes("chief") || sen.toLowerCase().includes("c-level")
        ? "CEO"
        : "OTHER";

    ins.run(
      id,
      lead.email,
      lead.firstName || null,
      lead.lastName || null,
      lead.phone || null,
      lead.title || null,
      lead.company || null,
      lead.companyDomain || null,
      lead.linkedinUrl || null,
      lead.seniority || null,
      "apollo",
      guessRole,
      now,
      now,
      now,
      now
    );

    database
      .prepare(`INSERT INTO interactions (id, contact_id, type, created_at, meta) VALUES (?, ?, 'UPDATED', ?, ?)`)
      .run(cuid(), id, now, JSON.stringify({ reason: "created_from_sync" }));

    return { id, created: true, changed: false, promoted: false };
  }

  // compute changes
  const updates = {};
  let anyChange = false;

  if (changed(existing.phone, lead.phone || null)) {
    updates.phone = lead.phone || null; anyChange = true;
  }
  if (changed(existing.title, lead.title || null)) {
    updates.title = lead.title || null; anyChange = true;
  }
  if (changed(existing.company, lead.company || null)) {
    updates.company = lead.company || null; anyChange = true;
  }
  if (changed(existing.company_domain, lead.companyDomain || null)) {
    updates.company_domain = lead.companyDomain || null; anyChange = true;
  }
  if (changed(existing.linkedin_url, lead.linkedinUrl || null)) {
    updates.linkedin_url = lead.linkedinUrl || null; anyChange = true;
  }
  if (changed(existing.seniority, lead.seniority || null)) {
    updates.seniority = lead.seniority || null; anyChange = true;
  }

  // promotion detection
  const oldSen = existing.seniority || "";
  const newSen = lead.seniority || "";
  const promoted = rank(newSen) > rank(oldSen);

  // always bump last seen/synced + active
  updates.last_seen_at = now;
  updates.last_synced_at = now;
  updates.is_active = 1;

  if (anyChange || promoted) {
    // write history snapshot
    const before = {
      phone: existing.phone,
      title: existing.title,
      seniority: existing.seniority,
      company: existing.company,
      companyDomain: existing.company_domain
    };
    const after = {
      phone: updates.phone ?? existing.phone,
      title: updates.title ?? existing.title,
      seniority: updates.seniority ?? existing.seniority,
      company: updates.company ?? existing.company,
      companyDomain: updates.company_domain ?? existing.company_domain
    };

    db()
      .prepare(
        `INSERT INTO contact_histories (id, contact_id, changed_at, reason, snapshot)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        cuid(),
        existing.id,
        now,
        promoted ? "promotion" : "field_change",
        JSON.stringify({ before, after })
      );

    // perform update
    const upd = database.prepare(`
      UPDATE contacts SET
        phone = COALESCE(?, phone),
        title = COALESCE(?, title),
        company = COALESCE(?, company),
        company_domain = COALESCE(?, company_domain),
        linkedin_url = COALESCE(?, linkedin_url),
        seniority = COALESCE(?, seniority),
        last_seen_at = ?,
        last_synced_at = ?,
        is_active = 1
      WHERE id = ?
    `);

    upd.run(
      updates.phone ?? null,
      updates.title ?? null,
      updates.company ?? null,
      updates.company_domain ?? null,
      updates.linkedin_url ?? null,
      updates.seniority ?? null,
      now,
      now,
      existing.id
    );

    database
      .prepare(`INSERT INTO interactions (id, contact_id, type, created_at, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(
        cuid(),
        existing.id,
        promoted ? "PROMOTED" : "UPDATED",
        now,
        JSON.stringify({ promoted })
      );
  } else {
    // bump timestamps only
    database
      .prepare(`UPDATE contacts SET last_seen_at = ?, last_synced_at = ?, is_active = 1 WHERE id = ?`)
      .run(now, now, existing.id);
  }

  return { id: existing.id, created: false, changed: anyChange, promoted };
}

export async function POST() {
  try {
    const database = db();

    const tracked = database
      .prepare(`SELECT id, domain FROM tracked_companies WHERE active = 1`)
      .all();

    const summary = [];

    for (const tc of tracked) {
      const roles = ["Chief", "VP", "Director", "Head", "Lead", "Manager"];
      let processed = 0;

      for (const role of roles) {
        const leads = await fetchApolloLeadsByDomain(tc.domain, role, 1);
        for (const l of leads) {
          // optional score (not stored)
          await aiScoreLead({ title: l.title, seniority: l.seniority }).catch(() => 0);
          await upsertContactFromLead(l);
          processed++;
        }
      }

      database
        .prepare(`UPDATE tracked_companies SET last_synced_at = ?, updated_at = ? WHERE id = ?`)
        .run(nowISO(), nowISO(), tc.id);

      summary.push({ domain: tc.domain, processed });
    }

    // deactivate stale contacts (not seen in 45 days)
    const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    database
      .prepare(`UPDATE contacts SET is_active = 0 WHERE last_seen_at < ?`)
      .run(cutoff);

    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "sync failed" }, { status: 500 });
  }
}
