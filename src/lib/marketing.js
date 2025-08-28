// src/lib/marketing.js
import { db, cuid, nowISO } from "@lib/sqlite";
import { fillTokens } from "@lib/tokens";

// Soft adapter for your existing mailer.
// Expect a function: sendEmail({ from, to, subject, text, html }) -> { ok, id, provider, status }
let _sendEmail = null;
try {
  const mod = await import("@lib/email");
  _sendEmail = mod?.sendEmail || null;
} catch (_) {
  _sendEmail = null;
}

function sendEmailAdapter({ from, to, subject, text, html }) {
  if (_sendEmail) return _sendEmail({ from, to, subject, text, html });
  // Fallback: pretend we queued it
  return Promise.resolve({ ok: false, id: null, provider: "mock", status: "queued" });
}

/* =========================
   SCHEMA (idempotent)
========================= */
export function ensureMarketingSchema(d = db()) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS marketing_campaigns (
      id          TEXT PRIMARY KEY,
      name        TEXT UNIQUE,
      description TEXT,
      status      TEXT DEFAULT 'active',
      created_at  TEXT,
      updated_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS marketing_campaign_steps (
      id             TEXT PRIMARY KEY,
      campaign_id    TEXT,
      step_order     INTEGER,
      delay_minutes  INTEGER DEFAULT 0, -- delay from previous step
      subject        TEXT,
      body           TEXT,
      -- Optional A/B
      subject_b      TEXT,
      body_b         TEXT,
      weight_b       INTEGER DEFAULT 0, -- 0..100
      use_ai         INTEGER DEFAULT 0,
      created_at     TEXT,
      updated_at     TEXT,
      UNIQUE(campaign_id, step_order)
    );

    CREATE TABLE IF NOT EXISTS marketing_enrollments (
      id              TEXT PRIMARY KEY,
      campaign_id     TEXT,
      contact_id      TEXT,
      status          TEXT DEFAULT 'active', -- active | completed | paused | error
      next_step_order INTEGER DEFAULT 1,
      next_run_at     TEXT,  -- when the next step is due
      last_sent_at    TEXT,
      variant_json    TEXT,  -- per-step AB map if you want to preassign
      data_json       TEXT,  -- per-contact vars snapshot
      created_at      TEXT,
      updated_at      TEXT,
      UNIQUE(campaign_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS marketing_sends (
      id           TEXT PRIMARY KEY,
      contact_id   TEXT,
      campaign_id  TEXT,
      step_order   INTEGER,
      provider     TEXT,
      provider_id  TEXT,
      status       TEXT,   -- queued/sent/delivered/opened/clicked/bounced/complained/failed
      subject      TEXT,
      body         TEXT,
      to_email     TEXT,
      meta         TEXT,
      sent_at      TEXT,
      updated_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS marketing_suppressions (
      id          TEXT PRIMARY KEY,
      contact_id  TEXT,
      reason      TEXT,   -- unsubscribe|complaint|bounce|manual
      created_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS marketing_config (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- performance
    CREATE INDEX IF NOT EXISTS idx_mkt_enroll_due ON marketing_enrollments(next_run_at, status);
    CREATE INDEX IF NOT EXISTS idx_mkt_sends_contact ON marketing_sends(contact_id);
    CREATE INDEX IF NOT EXISTS idx_mkt_sends_provider ON marketing_sends(provider, provider_id);
  `);

  // defaults (quiet hours 9..18 local, rate cap 200/hour)
  const get = d.prepare(`SELECT value FROM marketing_config WHERE key = ?`);
  const put = d.prepare(`INSERT OR REPLACE INTO marketing_config (key, value) VALUES (?, ?)`);
  if (!get.get("quiet_start")?.value) put.run("quiet_start", "09"); // 9 AM
  if (!get.get("quiet_end")?.value)   put.run("quiet_end",   "18"); // 6 PM
  if (!get.get("rate_per_hour")?.value) put.run("rate_per_hour", "200");
}

/* =========================
   CRUD helpers
========================= */
export function createCampaign({ name, description = "", steps = [] }) {
  const d = db();
  ensureMarketingSchema(d);
  const now = nowISO();

  const id = cuid();
  d.prepare(`
    INSERT INTO marketing_campaigns (id, name, description, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).run(id, name, description, now, now);

  const insStep = d.prepare(`
    INSERT INTO marketing_campaign_steps
      (id, campaign_id, step_order, delay_minutes, subject, body, subject_b, body_b, weight_b, use_ai, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  steps.forEach((s, i) => {
    insStep.run(
      cuid(), id,
      s.step_order ?? (i + 1),
      Number(s.delay_minutes ?? 0),
      String(s.subject || ""),
      String(s.body || ""),
      s.subject_b ? String(s.subject_b) : null,
      s.body_b ? String(s.body_b) : null,
      Number.isFinite(s.weight_b) ? Number(s.weight_b) : 0,
      s.use_ai ? 1 : 0,
      now, now
    );
  });

  return { id };
}

export function listCampaigns() {
  const d = db();
  ensureMarketingSchema(d);
  const campaigns = d.prepare(`SELECT * FROM marketing_campaigns ORDER BY created_at DESC`).all();
  const steps = d.prepare(`SELECT * FROM marketing_campaign_steps ORDER BY campaign_id, step_order`).all();
  return { campaigns, steps };
}

export function enrollContacts({ campaignId, contactIds = [], startAtISO = null, varsByContact = {} }) {
  const d = db();
  ensureMarketingSchema(d);
  const now = nowISO();
  const firstDelay = d.prepare(`
    SELECT COALESCE(MIN(delay_minutes), 0) AS delay FROM marketing_campaign_steps WHERE campaign_id = ?
  `).get(campaignId)?.delay ?? 0;

  const startBase = startAtISO || now;
  const nextRun = new Date(startBase);
  nextRun.setMinutes(nextRun.getMinutes() + Number(firstDelay || 0));
  const nextRunISO = nextRun.toISOString();

  const ins = d.prepare(`
    INSERT OR IGNORE INTO marketing_enrollments
      (id, campaign_id, contact_id, status, next_step_order, next_run_at, last_sent_at, variant_json, data_json, created_at, updated_at)
    VALUES (?, ?, ?, 'active', 1, ?, NULL, NULL, ?, ?, ?)
  `);

  let created = 0;
  for (const cid of contactIds) {
    const v = varsByContact?.[cid] ? JSON.stringify(varsByContact[cid]) : null;
    ins.run(cuid(), campaignId, cid, nextRunISO, v, now, now);
    created++;
  }
  return { created, next_run_at: nextRunISO };
}

/* =========================
   Ticking / Scheduler
========================= */
function withinQuietHours(now, startHour, endHour) {
  const h = now.getHours();
  const s = Number(startHour), e = Number(endHour);
  if (Number.isNaN(s) || Number.isNaN(e)) return true;
  if (s <= e) return h >= s && h < e;
  // overnight window like 22..06
  return h >= s || h < e;
}

function chooseVariant(step) {
  const w = Number(step.weight_b || 0);
  if (!step.subject_b && !step.body_b) return "A";
  const r = Math.floor(Math.random() * 100);
  return r < w ? "B" : "A";
}

function buildContent(step, variant, vars) {
  const subj = variant === "B" && step.subject_b ? step.subject_b : step.subject;
  const body = variant === "B" && step.body_b ? step.body_b : step.body;
  const subject = fillTokens(subj || "", vars || {});
  const text = fillTokens(body || "", vars || {});
  return { subject, text, html: text.replace(/\n/g, "<br/>") };
}

function rateLimiterState(d) {
  // very simple hour bucket
  const key = "rate_per_hour";
  const allowed = Number(d.prepare(`SELECT value FROM marketing_config WHERE key = ?`).get(key)?.value || "200");
  const stamp = new Date();
  const bucket = `${stamp.getUTCFullYear()}-${stamp.getUTCMonth()+1}-${stamp.getUTCDate()}-${stamp.getUTCHours()}`;

  // keep state in config
  const sKey = "rate_bucket";
  const cKey = "rate_count";

  const get = d.prepare(`SELECT value FROM marketing_config WHERE key = ?`);
  const put = d.prepare(`INSERT OR REPLACE INTO marketing_config (key, value) VALUES (?, ?)`);

  const curBucket = get.get(sKey)?.value || "";
  let curCount = Number(get.get(cKey)?.value || "0");

  if (curBucket !== bucket) {
    // reset
    put.run(sKey, bucket);
    put.run(cKey, "0");
    curCount = 0;
  }

  function take(n = 1) {
    if (curCount + n > allowed) return false;
    curCount += n;
    put.run(cKey, String(curCount));
    return true;
  }

  return { allowed, count: curCount, take };
}

export async function marketingTick({ batch = 50 } = {}) {
  const d = db();
  ensureMarketingSchema(d);

  const cfgGet = d.prepare(`SELECT key, value FROM marketing_config WHERE key IN ('quiet_start','quiet_end')`).all();
  const map = Object.fromEntries(cfgGet.map(r => [r.key, r.value]));
  const quietStart = map.quiet_start ?? "09";
  const quietEnd   = map.quiet_end ?? "18";

  const now = new Date();
  const nowISO = now.toISOString();

  // honor quiet hours: if outside, don't _send_ but you can reschedule due items to next window
  const isOkWindow = withinQuietHours(now, quietStart, quietEnd);

  const limiter = rateLimiterState(d);

  // Pull due enrollments
  const due = d.prepare(`
    SELECT e.*, c.email, c.first_name, c.last_name, c.company
    FROM marketing_enrollments e
    JOIN contacts c ON c.id = e.contact_id
    WHERE e.status = 'active' AND e.next_run_at <= ?
    ORDER BY e.next_run_at ASC
    LIMIT ?
  `).all(nowISO, batch);

  const stepQuery = d.prepare(`
    SELECT * FROM marketing_campaign_steps
    WHERE campaign_id = ? AND step_order = ?
  `);

  const updEnroll = d.prepare(`
    UPDATE marketing_enrollments
    SET next_step_order = ?, next_run_at = ?, last_sent_at = ?, updated_at = ?
    WHERE id = ?
  `);

  const markDone = d.prepare(`
    UPDATE marketing_enrollments SET status = 'completed', updated_at = ? WHERE id = ?
  `);

  const insSend = d.prepare(`
    INSERT INTO marketing_sends
      (id, contact_id, campaign_id, step_order, provider, provider_id, status, subject, body, to_email, meta, sent_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // suppressions
  const suppressed = d.prepare(`SELECT 1 FROM marketing_suppressions WHERE contact_id = ? LIMIT 1`);
  let processed = 0, sent = 0, queued = 0, skippedQuiet = 0, suppressedCount = 0, completed = 0;

  for (const e of due) {
    processed++;

    // suppression check
    if (suppressed.get(e.contact_id)) {
      suppressedCount++;
      // move to next step anyway to not loop forever
      const nextStep = e.next_step_order + 1;
      const stepNext = stepQuery.get(e.campaign_id, nextStep);
      if (stepNext) {
        const nextAt = new Date();
        nextAt.setMinutes(nextAt.getMinutes() + Number(stepNext.delay_minutes || 0));
        updEnroll.run(nextStep, nextAt.toISOString(), null, nowISO, e.id);
      } else {
        markDone.run(nowISO, e.id);
        completed++;
      }
      continue;
    }

    const step = stepQuery.get(e.campaign_id, e.next_step_order);
    if (!step) {
      markDone.run(nowISO, e.id);
      completed++;
      continue;
    }

    // reschedule to next quiet window if needed
    if (!isOkWindow) {
      const tomorrow = new Date();
      const startH = Number(quietStart);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(startH, 0, 0, 0);
      updEnroll.run(e.next_step_order, tomorrow.toISOString(), e.last_sent_at, nowISO, e.id);
      skippedQuiet++;
      continue;
    }

    // rate limit
    if (!limiter.take(1)) {
      break; // stop this tick; try next tick
    }

    // compose
    const vars = (e.data_json && JSON.parse(e.data_json)) || {
      first_name: e.first_name || "",
      last_name: e.last_name || "",
      company: e.company || "",
      month: now.toLocaleString("en-US", { month: "long" }),
      sender_name: process.env.SENDER_NAME || "Team"
    };
    const variant = chooseVariant(step);
    const content = buildContent(step, variant, vars);

    // send
    const from = process.env.RESEND_FROM || process.env.SENDER_EMAIL || null;
    const result = await sendEmailAdapter({
      from,
      to: e.email,
      subject: content.subject,
      text: content.text,
      html: content.html
    });

    const id = cuid();
    const status = result?.status || (result?.ok ? "sent" : "queued");
    if (status === "sent") sent++; else queued++;

    insSend.run(
      id, e.contact_id, e.campaign_id, e.next_step_order,
      result?.provider || "mock", result?.id || null, status,
      content.subject, content.text, e.email,
      JSON.stringify({ variant }),
      nowISO, nowISO
    );

    // move enrollment to next step
    const nextStepOrder = e.next_step_order + 1;
    const stepNext = stepQuery.get(e.campaign_id, nextStepOrder);
    if (stepNext) {
      const nextAt = new Date();
      nextAt.setMinutes(nextAt.getMinutes() + Number(stepNext.delay_minutes || 0));
      updEnroll.run(nextStepOrder, nextAt.toISOString(), nowISO, nowISO, e.id);
    } else {
      markDone.run(nowISO, e.id);
      completed++;
    }
  }

  return { processed, sent, queued, suppressed: suppressedCount, completed, skipped_quiet: skippedQuiet };
}
