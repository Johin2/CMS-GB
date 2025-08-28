// src/lib/db.js
import Database from 'better-sqlite3';
const db = new Database(process.env.NEWS_DB_PATH || './news.db');

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE,
  title TEXT,
  person_name TEXT,
  role TEXT,
  company TEXT,
  email TEXT,
  city TEXT,
  category TEXT,
  source TEXT,
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  month_label TEXT
);
CREATE INDEX IF NOT EXISTS idx_news_published_at ON news(published_at);
CREATE INDEX IF NOT EXISTS idx_news_month_label ON news(month_label);
`);

export function upsertMany(items) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO news
      (url, title, person_name, role, company, email, city, category, source, published_at, month_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows) => {
    rows.forEach((r) => {
      insert.run(
        r.url || '',
        r.title || '',
        r.person_name || '',
        r.role || '',
        r.company || '',
        r.email || '',
        r.city || '',
        r.category || '',
        r.source || '',
        r.published_at || '',
        r.month_label || ''
      );
    });
  });
  tx(items);
}

export function queryNews({ from, to, q, page, limit }) {
  const offset = (page - 1) * limit;
  const base = `
    SELECT * FROM news
    WHERE (published_at >= ? AND published_at <= ?)
  `;
  const params = [from + ' 00:00:00', to + ' 23:59:59'];

  let sql = base;
  if (q) {
    // simple multi-field LIKE (not regex)
    const t = `%${q.trim().toLowerCase()}%`;
    sql += `
      AND (
        lower(person_name) LIKE ? OR lower(role) LIKE ? OR lower(company) LIKE ? OR
        lower(city) LIKE ? OR lower(category) LIKE ? OR lower(source) LIKE ? OR
        lower(title) LIKE ?
      )
    `;
    params.push(t, t, t, t, t, t, t);
  }

  const countStmt = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as c'));
  const total = countStmt.get(...params).c;

  const listStmt = db.prepare(sql + ` ORDER BY published_at DESC LIMIT ? OFFSET ?`);
  const items = listStmt.all(...params, limit, offset);
  return { items, total };
}
