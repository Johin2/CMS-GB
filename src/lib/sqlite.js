import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

let _db;

/** ISO timestamp */
export function nowISO() {
  return new Date().toISOString();
}

/** simple id generator (uuid-based), no regex */
export function cuid() {
  return "id_" + randomUUID().split("-").join("");
}

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {}
}

/** Create tables if they don't exist; add missing columns if needed. */
function ensureCoreSchema(db) {
  // companies
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id         TEXT PRIMARY KEY,
      name       TEXT,
      domain     TEXT UNIQUE,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain);
  `);

  // contacts (lean, without last_seen_at/role/company_domain)
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id             TEXT PRIMARY KEY,
      email          TEXT UNIQUE,
      first_name     TEXT,
      last_name      TEXT,
      phone          TEXT,
      title          TEXT,
      seniority      TEXT,
      linkedin_url   TEXT,
      source         TEXT,
      email_status   TEXT,
      company_id     TEXT,
      company        TEXT,
      is_active      INTEGER DEFAULT 1,
      first_seen_at  TEXT,
      last_synced_at TEXT,
      updated_at     TEXT,
      created_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
    CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company);
  `);

  // add missing soft-delete columns if needed
  const cols = db.prepare(`PRAGMA table_info(contacts)`).all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("deleted_at")) db.exec(`ALTER TABLE contacts ADD COLUMN deleted_at TEXT`);
  if (!names.has("updated_at")) db.exec(`ALTER TABLE contacts ADD COLUMN updated_at TEXT`);
  if (!names.has("is_active")) db.exec(`ALTER TABLE contacts ADD COLUMN is_active INTEGER DEFAULT 1`);

  // sequences
  db.exec(`
    CREATE TABLE IF NOT EXISTS sequences (
      id          TEXT PRIMARY KEY,
      name        TEXT UNIQUE,
      description TEXT,
      created_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sequences_name ON sequences(name);
  `);

  // sequence steps
  db.exec(`
    CREATE TABLE IF NOT EXISTS sequence_steps (
      id           TEXT PRIMARY KEY,
      sequence_id  TEXT,
      step_order   INTEGER,
      subject      TEXT,
      body         TEXT,
      created_at   TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_seq_steps_unique ON sequence_steps(sequence_id, step_order);
  `);

  // interactions (audit trail)
  db.exec(`
    CREATE TABLE IF NOT EXISTS interactions (
      id         TEXT PRIMARY KEY,
      contact_id TEXT,
      type       TEXT,
      created_at TEXT,
      meta       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_interactions_contact ON interactions(contact_id);
  `);
}

let _dbPath = "";
export function db() {
  if (_db) return _db;

  const root = process.cwd();
  const fileFromEnv = process.env.DB_PATH && process.env.DB_PATH.trim();
  const dataDir = path.join(root, ".data");
  ensureDir(dataDir);
  const file = fileFromEnv || path.join(dataDir, "dev.db");

  _db = new Database(file);
  _dbPath = file;

  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");

  ensureCoreSchema(_db);
  return _db;
}

/** Expose the resolved DB file path for debugging */
export const dbPath = () => (_dbPath || (process.env.DB_PATH && process.env.DB_PATH.trim()) || path.join(process.cwd(), ".data", "dev.db"));
