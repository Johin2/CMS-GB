// src/lib/sources/gdelt.js
export const runtime = 'nodejs';

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

// Keep terms compact to avoid GDELT's length/complexity guard.
const ROLE_CHUNKS = [
  ['ceo','cfo','cto','cmo','cio','chro'],
  ['chairman','chairperson','president','vp','"vice president"'],
  ['"managing director"','md','director','chief','"general manager"','"country manager"','head']
];

const ACTION_CHUNKS = [
  // leadership changes (2 small sets)
  ['appoint','appointed','named','joins','promoted'],
  ['resigns','retires','"steps down"','elected','reappointed']
];

// awards/recognitions in a tiny pass at the end
const AWARD_CHUNK = ['award','awarded','"wins award"','felicitated'];

function ymdhms(d) {
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  return [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    pad(d.getUTCSeconds())
  ].join('');
}

function quoteIfNeeded(s) {
  return s.includes(' ') && !s.startsWith('"') ? `"${s}"` : s;
}

function buildQuery(actionTerms, roleTerms) {
  const a = '(' + actionTerms.map(quoteIfNeeded).join(' OR ') + ')';
  const r = '(' + roleTerms.map(quoteIfNeeded).join(' OR ') + ')';
  // country/language filters in-query per DOC 2.0
  return `${a} AND ${r} AND sourcecountry:IN AND sourcelang:english`;
}

// Read once; decide how to parse; surface GDELT's plaintext error messages.
async function fetchJSON(url) {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'user-agent': 'AugleNewsBot/1.0 (contact@example.com)' }
  });

  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`GDELT HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  if (!ctype.includes('application/json')) {
    throw new Error(`GDELT error: ${body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error(`GDELT JSON parse error: ${String(e)} | snippet: ${body.slice(0, 120)}`);
  }
}

async function tryQuery(startDate, endDate, actionTerms, roleTerms, maxRecords = 250) {
  const query = buildQuery(actionTerms, roleTerms);
  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    format: 'json',
    maxrecords: String(maxRecords),
    sort: 'DateDesc',
    startdatetime: ymdhms(startDate),
    enddatetime: ymdhms(endDate)
  });
  const url = `${GDELT_URL}?${params.toString()}`;
  const data = await fetchJSON(url);
  return Array.isArray(data?.articles) ? data.articles : [];
}

/**
 * Fetch a day window using multiple short combos to avoid "too short/too long" errors.
 * Dedupes by URL and lightly post-filters.
 */
export async function fetchGdeltWindow(startDate, endDate, maxRecords = 250) {
  const seen = new Set();
  const out = [];

  const combos = [];
  for (const roles of ROLE_CHUNKS) {
    for (const actions of ACTION_CHUNKS) {
      combos.push([actions, roles]);
    }
  }
  // do award passes last (optional, smaller volume)
  combos.push([AWARD_CHUNK, ROLE_CHUNKS[0]]);
  combos.push([AWARD_CHUNK, ROLE_CHUNKS[1]]);

  for (const [actions, roles] of combos) {
    try {
      const arts = await tryQuery(startDate, endDate, actions, roles, maxRecords);
      for (const a of arts) {
        const url = a.url || a.url_mobile || '';
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push({
          url,
          title: a.title || '',
          domain: a.domain || '',
          sourcecountry: (a.sourcecountry || '').toUpperCase(),
          language: (a.language || '').toUpperCase(),
          seendate: a.seendate || ''
        });
      }
      // stop early if we already have enough for the day
      if (out.length >= maxRecords) break;
    } catch (e) {
      const msg = String(e);
      // GDELT sometimes returns "Your query was too short or too long" or rate limits
      if (msg.includes('too short or too long') || msg.includes('429')) {
        console.warn('[GDELT combo warning]', msg.slice(0, 160));
        continue;
      }
      console.warn('[GDELT combo other]', msg.slice(0, 160));
      continue;
    }
  }

  // Light topical exclusions; keep recall high.
  return out
    .filter(a => a.url && a.title)
    .filter(a => a.language === 'ENGLISH')
    .filter(a => a.sourcecountry === 'IN' || a.domain.endsWith('.in'))
    .filter(a => {
      const t = a.title.toLowerCase();
      if (t.includes('cricket') || t.includes('football') || t.includes('ipl') || t.includes('fifa')) return false;
      if (t.includes('minister ') || t.includes(' election') || t.includes(' ias ') || t.includes(' ips ')) return false;
      if (t.includes('bollywood') || t.includes('actor') || t.includes('actress') || t.includes('movie')) return false;
      return true;
    });
}

/**
 * Chunk a date range into UTC day windows and fetch each.
 */
export async function fetchGdeltRange(fromISODate, toISODate) {
  const out = [];
  const from = new Date(fromISODate + 'T00:00:00Z');
  const to   = new Date(toISODate   + 'T23:59:59Z');

  const oneDay = 24 * 60 * 60 * 1000;
  for (let t = from.getTime(); t <= to.getTime(); t += oneDay) {
    const start = new Date(t);
    const end = new Date(Math.min(t + oneDay - 1000, to.getTime()));
    try {
      const rows = await fetchGdeltWindow(start, end);
      out.push(...rows);
    } catch (e) {
      console.warn('[GDELT day fetch warning]', start.toISOString().slice(0,10), String(e).slice(0, 180));
    }
  }
  return out;
}
