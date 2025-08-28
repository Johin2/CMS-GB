import { NextResponse } from "next/server";
import { db, cuid, nowISO } from "@lib/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APOLLO_BASE = "https://api.apollo.io"; // official base

function ensureContactsColumns(database) {
  const cols = database.prepare(`PRAGMA table_info(contacts)`).all() || [];
  const names = new Set(cols.map(c => c.name));
  if (!names.has("updated_at")) database.exec(`ALTER TABLE contacts ADD COLUMN updated_at TEXT`);
  if (!names.has("deleted_at")) database.exec(`ALTER TABLE contacts ADD COLUMN deleted_at TEXT`);
  if (!names.has("is_active"))  database.exec(`ALTER TABLE contacts ADD COLUMN is_active INTEGER DEFAULT 1`);
}

function normTitles(input) {
  if (!Array.isArray(input)) return [];
  return input.map(s => String(s || "").trim()).filter(Boolean);
}

async function apolloPOST(path, body, key) {
  const url = `${APOLLO_BASE}${path}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Api-Key": key
    },
    body: JSON.stringify(body)
  });
  const text = await r.text().catch(() => "");
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { ok: r.ok, status: r.status, json, url, body };
}

function mapApolloPerson(p) {
  // Handle both "people" and "contacts" style objects defensively
  const first = p.first_name || p.firstName || "";
  const last  = p.last_name  || p.lastName  || "";
  const title = p.title || "";
  const company =
    p.organization_name ||
    (p.organization && p.organization.name) ||
    p.company ||
    "";

  // Best-effort email extraction (depends on your plan/credits)
  let email = p.email || "";
  if (!email && Array.isArray(p.emails) && p.emails.length) {
    // pick the first verified or first available
    const verified = p.emails.find(e => e?.email && (e.type === "verified" || e.verified === true));
    email = (verified?.email || p.emails[0]?.email || "").toLowerCase();
  }

  const linkedin =
    p.linkedin_url ||
    p.linkedin ||
    (p.linkedin_handle ? `https://www.linkedin.com/in/${p.linkedin_handle}` : "") ||
    "";

  return {
    email,
    first_name: first,
    last_name: last,
    title,
    company,
    linkedin_url: linkedin
  };
}

export async function POST(req) {
  try {
    const { domain, titles = [], perPage = 5 } = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const allowFake = url.searchParams.get("allowFake") === "1";

    const domainNorm = String(domain || "").trim().toLowerCase();
    if (!domainNorm) {
      return NextResponse.json({ error: "domain required" }, { status: 400 });
    }

    const titlesNorm = normTitles(titles).slice(0, Math.max(1, Math.min(25, perPage)));
    const key = process.env.APOLLO_API_KEY || "";

    const database = db();
    ensureContactsColumns(database);
    const now = nowISO();

    // Upsert company by domain
    let companyId = null;
    let companyName = null;
    const co = database.prepare(`SELECT id, name FROM companies WHERE domain=?`).get(domainNorm);
    if (co) {
      companyId = co.id;
      companyName = co.name || domainNorm;
    } else {
      const id = cuid();
      database.prepare(`
        INSERT INTO companies (id, name, domain, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, domainNorm, domainNorm, now, now);
      companyId = id;
      companyName = domainNorm;
    }

    const apollo_debug = [];
    let leads = [];
    let source = "apollo-live";

    if (!key) {
      source = allowFake ? "apollo-fake-no-key" : "apollo-missing-key";
    } else {
      // Try the documented endpoints (Search). Both are credit-consuming on paid plans.
      // 1) mixed_people search (recommended in pricing docs)
      const payloadMixed = {
        page: 1,
        per_page: titlesNorm.length || perPage,
        organization_domain: domainNorm,       // primary filter by domain
        person_titles: titlesNorm,             // exact titles if you pass them
        open_factor_names: [],                 // keep empty unless you know what to pass
      };
      const r1 = await apolloPOST(`/v1/mixed_people/search`, payloadMixed, key);
      apollo_debug.push({ endpoint: r1.url, ok: r1.ok, status: r1.status, payload: payloadMixed, error: r1.json?.error });

      if (r1.ok && (Array.isArray(r1.json?.people) || Array.isArray(r1.json?.contacts))) {
        const arr = r1.json.people || r1.json.contacts || [];
        leads = arr.map(mapApolloPerson);
      } else if (r1.status === 404) {
        // Some orgs only have the /api/v1 prefix enabled (older docs show this form)
        const r1b = await apolloPOST(`/api/v1/mixed_people/search`, payloadMixed, key);
        apollo_debug.push({ endpoint: r1b.url, ok: r1b.ok, status: r1b.status, payload: payloadMixed, error: r1b.json?.error });
        if (r1b.ok && (Array.isArray(r1b.json?.people) || Array.isArray(r1b.json?.contacts))) {
          const arr = r1b.json.people || r1b.json.contacts || [];
          leads = arr.map(mapApolloPerson);
        }
      }

      // 2) As a fallback, try /v1/people/search (plain people search)
      if (leads.length === 0) {
        const payloadPeople = {
          page: 1,
          per_page: titlesNorm.length || perPage,
          organization_domain: domainNorm,
          person_titles: titlesNorm
        };
        const r2 = await apolloPOST(`/v1/people/search`, payloadPeople, key);
        apollo_debug.push({ endpoint: r2.url, ok: r2.ok, status: r2.status, payload: payloadPeople, error: r2.json?.error });

        if (r2.ok && Array.isArray(r2.json?.people)) {
          leads = r2.json.people.map(mapApolloPerson);
        } else if (r2.status === 404) {
          const r2b = await apolloPOST(`/api/v1/people/search`, payloadPeople, key);
          apollo_debug.push({ endpoint: r2b.url, ok: r2b.ok, status: r2b.status, payload: payloadPeople, error: r2b.json?.error });
          if (r2b.ok && Array.isArray(r2b.json?.people)) {
            leads = r2b.json.people.map(mapApolloPerson);
          }
        }
      }

      // If your current plan/key still returns 403 for search,
      // we error out unless you explicitly asked for a fake fill.
      const last = apollo_debug[apollo_debug.length - 1];
      if (leads.length === 0 && last && last.status === 403) {
        if (!allowFake) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "Apollo returned 403 (your plan/key may not include People Search API). " +
                "Upgrade or enable API access in Apollo, or call with ?allowFake=1 to generate test contacts.",
              apollo_debug
            },
            { status: 403 }
          );
        }
        source = "apollo-fake-403";
      }
    }

    // If still no leads and we are allowed to fake, create a tiny set
    if (leads.length === 0 && (allowFake || !key)) {
      const wanted = (titlesNorm.length ? titlesNorm : ["Chief Executive Officer", "Chief Marketing Officer"]).slice(0, perPage);
      leads = wanted.map((t, i) => ({
        email: `lead${i + 1}@${domainNorm}`,
        first_name: /executive/i.test(t) ? "Alex" : "Alicia",
        last_name: "Lead",
        title: t,
        company: companyName,
        linkedin_url: ""
      }));
      if (!key) source = "apollo-fake-no-key";
    }

    // Upsert contacts (only those with email; Apollo may return entries without an email depending on your plan)
    const sel = database.prepare(`SELECT id FROM contacts WHERE email=?`);
    const ins = database.prepare(`
      INSERT INTO contacts
        (id, email, first_name, last_name, phone, title, seniority, linkedin_url, source,
         email_status, company_id, company, is_active,
         first_seen_at, last_synced_at, updated_at, created_at)
      VALUES
        (?,  ?,    ?,          ?,     NULL,  ?,     NULL,       ?,           ?,
         'unverified', ?,        ?,      1,
         ?, ?, ?, ?)
    `);
    const upd = database.prepare(`
      UPDATE contacts SET
        first_name    = COALESCE(?, first_name),
        last_name     = COALESCE(?, last_name),
        title         = COALESCE(?, title),
        linkedin_url  = COALESCE(?, linkedin_url),
        company_id    = COALESCE(?, company_id),
        company       = COALESCE(?, company),
        last_synced_at= ?,
        updated_at    = ?,
        is_active     = 1
      WHERE email = ?
    `);

    let saved = 0;
    for (const L of leads) {
      const email = String(L.email || "").trim().toLowerCase();
      if (!email) continue; // skip entries without an email

      const row = sel.get(email);
      if (!row) {
        ins.run(
          cuid(), email, L.first_name || "Unknown", L.last_name || "", L.title || null,
          L.linkedin_url || null, source.includes("apollo") ? "apollo" : "manual",
          companyId, L.company || companyName,
          now, now, now, now
        );
      } else {
        upd.run(
          L.first_name || null, L.last_name || null, L.title || null,
          L.linkedin_url || null, companyId, L.company || companyName,
          now, now, email
        );
      }
      saved++;
    }

    return NextResponse.json({
      ok: true,
      domain: domainNorm,
      saved,
      source,
      apollo_debug
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "apollo fetch failed" }, { status: 500 });
  }
}
