// src/app/api/cron/news-outreach/route.js
import { NextRequest, NextResponse } from "next/server";
import { db, cuid, nowISO } from "@lib/sqlite";
import { fetchApolloContactByNameCompany } from "@lib/apollo";
import { sendEmailViaResend } from "@lib/email"; // <-- uses Resend SDK inside
import { generatePersonalizedEmail } from "@lib/personalize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* --------------------- helpers (no regex) --------------------- */

function firstLast(full) {
  const parts = String(full || "").trim().split(" ").filter(Boolean);
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ");
  return { firstName, lastName };
}

function ensureProspectsTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS news_prospects (
      id               TEXT PRIMARY KEY,
      news_item_id     TEXT UNIQUE REFERENCES news_items(id) ON DELETE CASCADE,
      person_name      TEXT,
      role             TEXT,
      company          TEXT,
      company_id       TEXT REFERENCES companies(id) ON DELETE SET NULL,
      contact_id       TEXT REFERENCES contacts(id) ON DELETE SET NULL,
      status           TEXT,
      last_error       TEXT,
      created_at       TEXT DEFAULT (datetime('now')),
      updated_at       TEXT DEFAULT (datetime('now')),
      last_attempt_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_news_prospects_status ON news_prospects(status);
  `);
}

function roleToSimpleRole(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("chief executive officer") || t === "ceo" || t.includes(" ceo")) return "CEO";
  if (t.includes("chief marketing officer") || t === "cmo" || t.includes(" cmo")) return "CMO";
  if (t.includes("chief financial officer") || t === "cfo" || t.includes(" cfo")) return "CFO";
  if (t.includes("chief product officer") || t === "cpo" || t.includes(" cpo")) return "CPO";
  if (t.includes("chief technology officer") || t === "cto" || t.includes(" cto")) return "CTO";
  return "OTHER";
}

function keepAlphaNum(s) {
  let out = "";
  const src = String(s || "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const code = ch.charCodeAt(0);
    const isAZ = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const is09 = code >= 48 && code <= 57;
    if (isAZ || is09) out += ch;
  }
  return out;
}

function toCandidateDomain(company) {
  const base = keepAlphaNum(String(company || "").toLowerCase());
  if (!base) return "example.test";
  return base + ".test";
}

function toEmailLocalPart(first, last) {
  const f = String(first || "").toLowerCase();
  const l = String(last || "").toLowerCase();
  let base = f;
  if (l) base = f + "." + l;
  let out = "";
  for (let i = 0; i < base.length; i++) {
    const ch = base[i];
    const code = ch.charCodeAt(0);
    const isAZ = code >= 97 && code <= 122;
    const is09 = code >= 48 && code <= 57;
    if (isAZ || is09 || ch === ".") out += ch;
  }
  if (!out) out = "contact";
  return out;
}

function fakeLeadFromNews(personName, companyName, companyDomain) {
  const names = firstLast(personName || "");
  const domain = companyDomain || toCandidateDomain(companyName || "");
  const local = toEmailLocalPart(names.firstName, names.lastName);
  const email = local + "@" + domain;
  const phone = "+91 98765 43210";
  const lh = (names.firstName + (names.lastName ? "-" + names.lastName : "")).toLowerCase();
  const linkedinUrl = "https://www.linkedin.com/in/" + keepAlphaNum(lh);
  return {
    firstName: names.firstName,
    lastName: names.lastName,
    email,
    phone,
    title: undefined,
    seniority: undefined,
    linkedinUrl,
    company: companyName || "",
    companyDomain: domain
  };
}

/* --------------------- main --------------------- */

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const days = Math.max(1, Math.min(60, Number(url.searchParams.get("days") || 14)));
    const fake = url.searchParams.get("fake") === "1";
    const dry = url.searchParams.get("dry") === "1";
    const any = url.searchParams.get("any") === "1"; // include all categories when testing
    const limit = Math.max(1, Math.min(300, Number(url.searchParams.get("limit") || 200)));

    const database = db();
    ensureProspectsTable(database);

    const toISO = nowISO();
    const fromISO = new Date(Date.now() - days * 86400000).toISOString();

    // 1) pick candidate news rows
    let baseSQL = `
      SELECT id, person_name, role, company, url, source, published_at
      FROM news_items
      WHERE published_at >= ? AND published_at <= ?
        AND person_name IS NOT NULL AND TRIM(person_name) <> ''
        AND company IS NOT NULL AND TRIM(company) <> ''
    `;
    if (!any) {
      baseSQL += `
        AND (LOWER(category) = 'role change' OR LOWER(category) = 'achievement')
      `;
    }
    baseSQL += ` ORDER BY published_at DESC LIMIT ?`;

    const newsRows = database.prepare(baseSQL).all(fromISO, toISO, limit);

    if (!newsRows || newsRows.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, note: "no news rows in range" });
    }

    // Prepared statements
    const selCompanyByName = database.prepare(`SELECT id, name, domain FROM companies WHERE LOWER(name) = LOWER(?)`);
    const insCompany = database.prepare(`
      INSERT INTO companies (id, name, domain, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?)
    `);

    const selByEmail = database.prepare(`SELECT id FROM contacts WHERE email = ?`);
    const insContact = database.prepare(`
      INSERT INTO contacts
        (id, email, first_name, last_name, phone, title, seniority, linkedin_url, source,
         role, email_status, company_id, company, company_domain, is_active,
         first_seen_at, last_seen_at, last_synced_at, created_at)
      VALUES
        (?,  ?,    ?,          ?,        ?,     ?,     ?,         ?,            ?,
         ?,    ?,           ?,         ?,       ?,              1,
         ?,           ?,            ?,             ?)
    `);
    const updContact = database.prepare(`
      UPDATE contacts SET
        phone = COALESCE(?, phone),
        title = COALESCE(?, title),
        seniority = COALESCE(?, seniority),
        linkedin_url = COALESCE(?, linkedin_url),
        company_id = COALESCE(?, company_id),
        company = COALESCE(?, company),
        company_domain = COALESCE(?, company_domain),
        last_seen_at = ?,
        last_synced_at = ?,
        is_active = 1
      WHERE id = ?
    `);

    const insProspect = database.prepare(`
      INSERT OR IGNORE INTO news_prospects
        (id, news_item_id, person_name, role, company, company_id, status, created_at, updated_at)
      VALUES
        (?,  ?,            ?,           ?,    ?,       ?,          'awaiting_apollo', ?,         ?)
    `);
    const selProspect = database.prepare(`SELECT * FROM news_prospects WHERE news_item_id = ?`);
    const updProspectStatus = database.prepare(`
      UPDATE news_prospects
      SET status = ?, last_error = ?, contact_id = COALESCE(?, contact_id),
          updated_at = ?, last_attempt_at = ?
      WHERE news_item_id = ?
    `);

    const insInteraction = database.prepare(`
      INSERT INTO interactions (id, contact_id, type, created_at, meta)
      VALUES (?, ?, ?, ?, ?)
    `);

    let processed = 0, emailed = 0, awaiting = 0, enrichedOnly = 0, failed = 0;
    const drafts = [];

    const haveApollo = !!process.env.APOLLO_API_KEY && !fake; // disable Apollo when fake=1
    const haveResend = !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM;
    const testSink = String(process.env.NEWS_OUTREACH_TEST_EMAIL || "").trim();

    for (const n of newsRows) {
      processed++;
      const now = nowISO();

      // 2) Upsert company by name
      let companyRow = selCompanyByName.get(n.company);
      if (!companyRow) {
        const cid = cuid();
        insCompany.run(cid, n.company, now, now);
        companyRow = { id: cid, name: n.company, domain: null };
      }

      // 3) Ensure prospect row
      const pid = cuid();
      insProspect.run(pid, n.id, n.person_name, n.role, n.company, companyRow.id, now, now);
      const prospect = selProspect.get(n.id);

      // 4) Get a lead (Apollo or Fake)
      let contactId = (prospect && prospect.contact_id) || null;
      let lead = null;

      if (haveApollo) {
        lead = await fetchApolloContactByNameCompany(n.person_name, n.company);
      } else if (fake) {
        lead = fakeLeadFromNews(n.person_name, n.company, companyRow.domain);
      }

      if (lead && lead.email) {
        const existing = selByEmail.get(lead.email);
        const simpleRole = roleToSimpleRole(n.role || (lead.title || ""));

        if (!existing) {
          const id = cuid();
          insContact.run(
            id,
            lead.email,
            lead.firstName || "",
            lead.lastName || "",
            lead.phone || null,
            lead.title || (n.role || null),
            lead.seniority || null,
            lead.linkedinUrl || null,
            haveApollo ? "apollo" : "fake",
            simpleRole,
            "unverified",
            companyRow.id,
            companyRow.name || n.company,
            lead.companyDomain || companyRow.domain || null,
            now, now, now, now
          );
          contactId = id;
        } else {
          updContact.run(
            lead.phone || null,
            lead.title || (n.role || null),
            lead.seniority || null,
            lead.linkedinUrl || null,
            companyRow.id,
            companyRow.name || n.company,
            lead.companyDomain || companyRow.domain || null,
            now, now,
            existing.id
          );
          contactId = existing.id;
        }
      }

      // 5) Personalize draft
      let draft = null;
      if (contactId && lead) {
        const names = firstLast(n.person_name || "");
        draft = await generatePersonalizedEmail({
          person: {
            firstName: names.firstName || undefined,
            lastName: names.lastName || undefined,
            email: lead.email,
            title: lead.title || n.role || undefined,
            seniority: lead.seniority || undefined,
            linkedinUrl: lead.linkedinUrl || undefined
          },
          company: {
            name: companyRow.name || n.company || null,
            domain: lead.companyDomain || companyRow.domain || null,
            industry: null
          },
          roleHint: n.role || undefined,
          achievements: [
            {
              title: n.person_name + (n.role ? " — " + n.role : ""),
              source: n.source || "News",
              url: n.url || "",
              date: n.published_at || ""
            }
          ],
          tone: "concise"
        });
      }

      // 6) Send or store status
      if (contactId && lead && draft) {
        const toAddress = fake && testSink ? testSink : lead.email;

        if (dry) {
          drafts.push({ to: toAddress, subject: draft.subject || "", preview: draft.preview || "", url: n.url || "" });
          updProspectStatus.run("dry_run", null, contactId, nowISO(), nowISO(), n.id);
          continue;
        }

        if (!haveResend) {
          updProspectStatus.run("queued_email", "resend_not_configured", contactId, nowISO(), nowISO(), n.id);
          continue;
        }

        if (fake && !testSink) {
          updProspectStatus.run("queued_email", "set NEWS_OUTREACH_TEST_EMAIL to send in fake mode", contactId, nowISO(), nowISO(), n.id);
          continue;
        }

        // === Resend SDK via helper (@lib/email) ===
        try {
          const providerRes = await sendEmailViaResend({
            to: toAddress,
            subject: draft.subject || `Quick note for ${companyRow.name}`,
            html: draft.bodyHtml || ""
          });

          insInteraction.run(
            cuid(),
            contactId,
            "SENT",
            nowISO(),
            JSON.stringify({
              via: "news-outreach",
              news_item_id: n.id,
              url: n.url,
              subject: draft.subject || "",
              provider: "resend",
              providerRes, // typically includes an { id }
              fake
            })
          );

          updProspectStatus.run(fake ? "emailed(fake)" : "emailed", null, contactId, nowISO(), nowISO(), n.id);
          emailed++;
        } catch (err) {
          updProspectStatus.run("failed", String(err?.message || err), contactId, nowISO(), nowISO(), n.id);
          failed++;
        }
      } else {
        if (!lead) {
          if (fake) {
            updProspectStatus.run("failed", "fake_lead_missing", contactId || null, nowISO(), nowISO(), n.id);
          } else if (!process.env.APOLLO_API_KEY) {
            updProspectStatus.run("awaiting_apollo", null, contactId || null, nowISO(), nowISO(), n.id);
            awaiting++;
          } else {
            updProspectStatus.run("enriched", "no_email_found", contactId || null, nowISO(), nowISO(), n.id);
            enrichedOnly++;
          }
        } else {
          updProspectStatus.run("failed", "unknown_state", contactId || null, nowISO(), nowISO(), n.id);
          failed++;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      processed,
      emailed,
      awaiting_apollo: awaiting,
      enriched_no_email: enrichedOnly,
      failed,
      dry,
      fake,
      drafts
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || "news-outreach failed" }, { status: 500 });
  }
}
