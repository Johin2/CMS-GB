'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Users, Building2, Search, Plus, RefreshCw, TrendingUp, BadgeAlert, Clock } from 'lucide-react';
import StatCard from '../components/StatCard';
// import QuickStart from '../components/QuickStart'; // removed

/* =========================================================
   Small helpers
   ========================================================= */
async function fetchJSON(url, init) {
  const origin =
    typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin;
  const u = new URL(url, origin);
  // cache buster + disable caches
  u.searchParams.set('ts', String(Date.now()));
  const res = await fetch(u.toString(), { cache: 'no-store', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data)?.error || `Request failed: ${res.status}`);
  return data;
}

function toDayLabel(d) {
  return new Date(d).toLocaleDateString(undefined, { weekday: 'short' });
}

function startOfDayISO(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function daysBetween(a, b) {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}


function transformContacts(rows = []){
  return rows.map((r) => ({
    id: r.id,
    name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || '—',
    role: r.title || '',
    company: r.co_name || r.company || '',
    email: r.email,
    status: r.is_active ? 'active' : 'inactive',
    created_at: r.created_at,
    updated_at: r.updated_at,
    // keep originals
    ...r,
  }));
}

/* =========================================================
   Tiny inline components (chart & simple tables)
   ========================================================= */
function MiniBars({ data }) {
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label}>
          <div className="flex items-center justify-between text-xs text-white/70">
            <span className="truncate">{d.label}</span>
            <span>{d.value}</span>
          </div>
          <div className="mt-1 h-2 w-full rounded bg-white/10">
            <div
              className="h-2 rounded bg-white/70"
              style={{ width: `${Math.max(0, Math.min(1, d.pct)) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Card({
  title,
  children,
  Icon,
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        {Icon ? <Icon className="h-4 w-4 text-white/70" /> : null}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/* =========================================================
   Page
   ========================================================= */
export default function OutreachDashboard() {
  // UI state
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Data state
  const [stats, setStats] = useState({ contacts: 0, companies: 0 });
  const [trend, setTrend] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [health, setHealth] = useState({
    newThisWeek: 0,
    missingTitles: 0,
    duplicateEmails: 0,
    completenessPct: 0,
  });
  const [topCompanies, setTopCompanies] = useState([]);
  const [topTitles, setTopTitles] = useState([]);

  // New panels state
  const [staleContacts, setStaleContacts] = useState([]);
  const [topDomains, setTopDomains] = useState([]);

  async function loadStats() {
    let contactsCount = 0;
    let companiesCount = 0;
    try {
      const facets = await fetchJSON('/api/contacts/facets');
      contactsCount = (facets)?.total_contacts || 0;
      companiesCount = Array.isArray((facets)?.companies) ? (facets).companies.length : 0;
    } catch {
      // ignore
    }
    setStats({ contacts: contactsCount, companies: companiesCount });
  }

  async function autoSync() {
    try {
      await fetchJSON('/api/news/auto_sync_now', { method: 'POST' });
    } catch {
      // best-effort
    }
  }

  useEffect(() => {
    let cancelled = false;
    const syncAndLoad = async () => {
      try {
        await autoSync();
        await loadAll();
      } catch {}
    };

    // run on mount + hourly while visible
    syncAndLoad();
    const HOUR = 60 * 60 * 1000;
    const id = setInterval(() => {
      if (!cancelled && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        syncAndLoad();
      }
    }, HOUR);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadContactsAndInsights() {
    try {
      // Pull up to 1k for meaningful aggregates
      const data = await fetchJSON('/api/contacts/list?limit=1000&page=1');
      const items = Array.isArray((data)?.items) ? (data).items : [];
      const rows = transformContacts(items);
      setContacts(rows);

      // ===== Growth trend (7 days, contacts created/updated) =====
      const countsByDay = new Map();
      const today = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        countsByDay.set(startOfDayISO(d), 0);
      }
      rows.forEach((r) => {
        const stamp = r.created_at || r.updated_at || new Date().toISOString();
        const bucket = startOfDayISO(stamp);
        if (countsByDay.has(bucket)) {
          countsByDay.set(bucket, (countsByDay.get(bucket) || 0) + 1);
        }
      });
      const series = Array.from(countsByDay.entries()).map(([iso, value]) => ({
        label: toDayLabel(iso),
        value,
      }));
      setTrend(series);

      // ===== Data health =====
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      let newThisWeek = 0;
      let missingTitles = 0;
      const emailCounts = new Map();
      let completeCount = 0;

      rows.forEach((r) => {
        const created = r.created_at ? new Date(r.created_at) : null;
        if (created && created >= oneWeekAgo) newThisWeek += 1;

        if (!r.role) missingTitles += 1;

        const email = (r.email || '').trim().toLowerCase();
        if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);

        // crude completeness: has name, email, company, role
        const hasName = Boolean(r.name && r.name.trim());
        const hasEmail = Boolean(email);
        const hasCompany = Boolean(r.company && r.company.trim());
        const hasRole = Boolean(r.role && r.role.trim());
        if (hasName && hasEmail && hasCompany && hasRole) completeCount += 1;
      });

      let duplicateEmails = 0;
      emailCounts.forEach((c) => {
        if (c > 1) duplicateEmails += c - 1;
      });

      const completenessPct = rows.length ? Math.round((completeCount / rows.length) * 100) : 0;

      setHealth({ newThisWeek, missingTitles, duplicateEmails, completenessPct });

      // ===== Top companies =====
      const byCompany = new Map();
      rows.forEach((r) => {
        const key = (r.company || '—').trim() || '—';
        byCompany.set(key, (byCompany.get(key) || 0) + 1);
      });
      const companiesArr = Array.from(byCompany.entries())
        .filter(([name]) => name !== '—')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count], _, all) => ({
          name,
          count,
          pct: all.length ? count / all[0][1] : 0, // scale bars to the top value
        }));
      setTopCompanies(companiesArr);

      // ===== Top titles =====
      const byTitle = new Map();
      rows.forEach((r) => {
        const t = (r.role || '').trim();
        if (!t) return;
        byTitle.set(t, (byTitle.get(t) || 0) + 1);
      });
      const titlesArr = Array.from(byTitle.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([title, count], _, all) => ({
          title,
          count,
          pct: all.length ? count / all[0][1] : 0,
        }));
      setTopTitles(titlesArr);

      // ===== Stale Contacts (no updates in 30+ days) =====
      const now = new Date();
      const stale = rows
        .map((r) => {
          const ref = r.updated_at || r.created_at || now.toISOString();
          const daysStale = daysBetween(now, new Date(ref));
          return { id: r.id, name: r.name, company: r.company || '—', daysStale };
        })
        .filter((x) => x.daysStale >= 30)
        .sort((a, b) => b.daysStale - a.daysStale)
        .slice(0, 8);
      setStaleContacts(stale);

      // ===== Top Email Domains =====
      const domainMap = new Map();
      rows.forEach((r) => {
        const e = (r.email || '').trim().toLowerCase();
        const atIndex = e.indexOf('@');
        if (atIndex > -1 && atIndex < e.length - 1) {
          const domain = e.slice(atIndex + 1);
          if (domain) domainMap.set(domain, (domainMap.get(domain) || 0) + 1);
        }
      });
      const domainArr = Array.from(domainMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([domain, count], _, all) => ({
          domain,
          count,
          pct: all.length ? count / all[0][1] : 0,
        }));
      setTopDomains(domainArr);
    } catch {
      setContacts([]);
      setTrend([]);
      setHealth({ newThisWeek: 0, missingTitles: 0, duplicateEmails: 0, completenessPct: 0 });
      setTopCompanies([]);
      setTopTitles([]);
      setStaleContacts([]);
      setTopDomains([]);
    }
  }

  async function loadAll() {
    setLoading(true);
    try {
      await Promise.all([loadStats(), loadContactsAndInsights()]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }

  // Quick filter affects list-style insight cards
  const q = query.trim().toLowerCase();

  const filteredCompanies = useMemo(() => {
    if (!q) return topCompanies;
    return topCompanies.filter((c) => c.name.toLowerCase().includes(q));
  }, [q, topCompanies]);

  const filteredTitles = useMemo(() => {
    if (!q) return topTitles;
    return topTitles.filter((t) => t.title.toLowerCase().includes(q));
  }, [q, topTitles]);

  const filteredDomains = useMemo(() => {
    if (!q) return topDomains;
    return topDomains.filter((d) => d.domain.toLowerCase().includes(q));
  }, [q, topDomains]);

  const filteredStale = useMemo(() => {
    if (!q) return staleContacts;
    return staleContacts.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.company || '').toLowerCase().includes(q)
    );
  }, [q, staleContacts]);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 pt-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Glassbox Dashboard</h1>
          <p className="mt-1 text-sm text-white/60">
            Live view of contacts, companies, growth & data quality.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/contacts"
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
          >
            <Plus className="h-4 w-4" />
            Add Contacts
          </Link>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            title="Refresh"
          >
            {refreshing ? <LoaderMini /> : <RefreshCw className="h-4 w-4" />}
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 py-8">
        {/* KPI cards */}
        <section className="grid gap-4 md:grid-cols-3">
          <StatCard
            title="Contacts"
            value={stats.contacts}
            Icon={Users}
            hint="People you can reach out to"
          />
          <StatCard
            title="Companies"
            value={stats.companies}
            Icon={Building2}
            hint="Organizations in your workspace"
          />
          <StatCard
            title="New this week"
            value={health.newThisWeek}
            Icon={TrendingUp}
            hint="Contacts created in the last 7 days"
          />
        </section>

        {/* Replaced QuickStart section with useful insight panels */}
        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          {/* Left: two practical, live-data cards */}
          <div className="lg:col-span-2 grid gap-4 sm:grid-cols-2">
            {/* Stale Contacts */}
            <Card title="Stale Contacts (30d+)" Icon={Clock}>
              {loading ? (
                <div className="p-6 text-center text-white/60">Loading…</div>
              ) : filteredStale.length ? (
                <ul className="space-y-2 text-sm">
                  {filteredStale.map((s) => (
                    <li key={`${s.id}-${s.name}-${s.daysStale}`} className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="truncate">{s.name}</div>
                        <div className="truncate text-xs text-white/50">{s.company || '—'}</div>
                      </div>
                      <span className="ml-3 shrink-0 rounded bg-white/10 px-2 py-0.5 text-xs text-white/80">
                        {s.daysStale}d
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-white/60">No stale contacts over 30 days 🎉</div>
              )}
            </Card>

            {/* Top Email Domains */}
            <Card title="Top Email Domains">
              {loading ? (
                <div className="p-6 text-center text-white/60">Loading…</div>
              ) : filteredDomains.length ? (
                <MiniBars
                  data={filteredDomains.map((d) => ({
                    label: d.domain,
                    value: d.count,
                    pct: d.pct,
                  }))}
                />
              ) : (
                <div className="text-sm text-white/60">No domains match your filter.</div>
              )}
            </Card>
          </div>

          {/* Right: 7-day Growth */}
          <Card title="7-day Growth" Icon={TrendingUp}>
            {loading ? (
              <div className="p-6 text-center text-white/60">Loading…</div>
            ) : trend.length ? (
              <MiniBars
                data={trend.map((d) => ({
                  label: d.label,
                  value: d.value,
                  pct:
                    trend.length && Math.max(...trend.map((x) => x.value)) > 0
                      ? d.value / Math.max(...trend.map((x) => x.value))
                      : 0,
                }))}
              />
            ) : (
              <div className="text-sm text-white/60">No activity in the last 7 days.</div>
            )}
          </Card>
        </section>

        {/* Search + Insight cards */}
        <section className="mt-6">
          {/* Search box filtering the lists below */}
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter companies, titles, domains, or stale contacts…"
                className="w-full rounded-lg border border-white/10 bg-black px-9 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/30"
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Data Health Overview */}
            <Card title="Data Health" Icon={BadgeAlert}>
              {loading ? (
                <div className="p-6 text-center text-white/60">Loading…</div>
              ) : (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-white/60">Completeness</div>
                    <div className="mt-1 text-2xl font-semibold">{health.completenessPct}%</div>
                    <div className="mt-1 text-xs text-white/50">
                      Name, email, company & role present
                    </div>
                  </div>
                  <div>
                    <div className="text-white/60">Missing titles</div>
                    <div className="mt-1 text-2xl font-semibold">{health.missingTitles}</div>
                    <div className="mt-1 text-xs text-white/50">Add roles for better targeting</div>
                  </div>
                  <div>
                    <div className="text-white/60">Duplicate emails</div>
                    <div className="mt-1 text-2xl font-semibold">{health.duplicateEmails}</div>
                    <div className="mt-1 text-xs text-white/50">Merge to avoid double outreach</div>
                  </div>
                  <div>
                    <div className="text-white/60">New this week</div>
                    <div className="mt-1 text-2xl font-semibold">{health.newThisWeek}</div>
                    <div className="mt-1 text-xs text-white/50">Fresh records added</div>
                  </div>
                </div>
              )}
            </Card>

            {/* Top Companies */}
            <Card title="Top Companies">
              {loading ? (
                <div className="p-6 text-center text-white/60">Loading…</div>
              ) : filteredCompanies.length ? (
                <MiniBars
                  data={filteredCompanies.map((c) => ({
                    label: c.name,
                    value: c.count,
                    pct: c.pct,
                  }))}
                />
              ) : (
                <div className="text-sm text-white/60">No companies match your filter.</div>
              )}
            </Card>

            {/* Title / Role Breakdown */}
            <Card title="Top Roles / Titles">
              {loading ? (
                <div className="p-6 text-center text-white/60">Loading…</div>
              ) : filteredTitles.length ? (
                <MiniBars
                  data={filteredTitles.map((t) => ({
                    label: t.title,
                    value: t.count,
                    pct: t.pct,
                  }))}
                />
              ) : (
                <div className="text-sm text-white/60">No titles match your filter.</div>
              )}
            </Card>
          </div>
        </section>

        <p className="mt-8 text-center text-xs text-gray-500">
          Tip: these tiles fetch live data with cache busting. If you change DB data and don’t see
          updates, ensure your API routes have <code>export const dynamic = 'force-dynamic'</code>.
        </p>
      </main>
    </div>
  );
}

/* Tiny inline loader to keep the file self-contained */
function LoaderMini() {
  return (
    <svg className="h-4 w-4 animate-spin text-white/80" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
