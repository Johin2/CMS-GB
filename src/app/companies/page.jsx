'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Building2 } from 'lucide-react';

export default function CompaniesPage() {
  const [items, setItems] = useState([]);
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch('/api/tracked-companies');
    const data = await res.json();
    setItems(data.items || []);
  }

  useEffect(() => { load(); }, []);

  async function add() {
    setLoading(true);
    await fetch('/api/tracked-companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, name })
    });
    setDomain(''); setName('');
    await load();
    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="mt-1 text-sm text-white/60">Track organizations you want to keep in sync.</p>
        </header>

        <section className="rounded-2xl border border-white/10 bg-black/50 p-5">
          <div className="grid gap-3 md:grid-cols-[2fr,2fr,auto]">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">Domain</label>
              <input
                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/30"
                placeholder="acme.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">Display name (optional)</label>
              <input
                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/30"
                placeholder="Acme"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={add}
                disabled={loading || !domain.trim()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-black px-4 py-2 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {loading ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-3 md:grid-cols-2">
          {items.map((c) => (
            <div key={c.id} className="rounded-2xl border border-white/10 bg-black/50 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black">
                  <Building2 className="h-5 w-5 text-white/70" />
                </div>
                <div>
                  <div className="font-medium">{c.name || c.domain}</div>
                  <div className="text-xs text-white/60">{c.domain}</div>
                </div>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-white/60">
              No companies yet — add your first one above.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
