PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT,
  domain TEXT UNIQUE,
  industry TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  title TEXT,
  seniority TEXT,
  linkedin_url TEXT,
  source TEXT,
  role TEXT DEFAULT 'OTHER',             -- CEO/CMO/...
  email_status TEXT,                     -- unverified/verified/bounced
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  company TEXT,                          -- denormalized name (was companyName)
  company_domain TEXT,
  is_active INTEGER DEFAULT 1,
  first_seen_at TEXT DEFAULT (datetime('now')),
  last_seen_at  TEXT DEFAULT (datetime('now')),
  last_synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_company_id ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_last_seen ON contacts(last_seen_at);

CREATE TABLE IF NOT EXISTS sequences (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sequence_steps (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(sequence_id, step_order)
);

CREATE TABLE IF NOT EXISTS email_queue (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL REFERENCES sequence_steps(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'queued',          -- queued/sending/sent/failed
  scheduled_at TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_queue_status_scheduled ON email_queue(status, scheduled_at);

CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  sequence_id TEXT REFERENCES sequences(id),
  sequence_step_id TEXT REFERENCES sequence_steps(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'queued',
  scheduled_at TEXT,
  sent_at TEXT,
  opened_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                    -- SENT | OPENED | UPDATED | PROMOTED
  created_at TEXT DEFAULT (datetime('now')),
  meta TEXT                              -- JSON string
);

CREATE INDEX IF NOT EXISTS idx_interactions_contact_created ON interactions(contact_id, created_at);

CREATE TABLE IF NOT EXISTS contact_histories (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  changed_at TEXT DEFAULT (datetime('now')),
  reason TEXT,
  snapshot TEXT                          -- JSON string
);

CREATE INDEX IF NOT EXISTS idx_histories_contact_changed ON contact_histories(contact_id, changed_at);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_segments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, segment_id)
);

CREATE TABLE IF NOT EXISTS tracked_companies (
  id TEXT PRIMARY KEY,
  name TEXT,
  domain TEXT UNIQUE,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  last_synced_at TEXT
);

-- Exec/news items (weekly ingest)
CREATE TABLE IF NOT EXISTS news_items (
  id            TEXT PRIMARY KEY,
  person_name   TEXT,
  role          TEXT,
  email         TEXT,
  company       TEXT,
  city          TEXT,
  url           TEXT UNIQUE,
  source        TEXT,
  published_at  TEXT,         -- ISO string
  month_label   TEXT,         -- e.g., "January"
  category      TEXT,         -- e.g., "In the News"
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news_prospects (
  id               TEXT PRIMARY KEY,
  news_item_id     TEXT UNIQUE REFERENCES news_items(id) ON DELETE CASCADE,
  person_name      TEXT,
  role             TEXT,
  company          TEXT,
  company_id       TEXT REFERENCES companies(id) ON DELETE SET NULL,
  contact_id       TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  status           TEXT,           -- awaiting_apollo | enriched | emailed | queued_email | failed
  last_error       TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now')),
  last_attempt_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_news_prospects_status ON news_prospects(status);

CREATE INDEX IF NOT EXISTS idx_news_month ON news_items(month_label);
CREATE INDEX IF NOT EXISTS idx_news_date  ON news_items(published_at);
