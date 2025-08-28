// app/contacts/all/page.jsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Loader2, Users, Trash2, X, Pencil } from 'lucide-react';

/** API base resolver */
const API_BASE = (() => {
  const env = process.env.NEXT_PUBLIC_API_BASE;
  if (env && /^https?:\/\//i.test(env)) return env.replace(/\/+$/, '');
  if (typeof window !== 'undefined') return `${window.location.origin}/api`;
  return 'http://127.0.0.1:8000/api';
})();
const joinUrl = (base, path) =>
  `${base.replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;

/** Fetch wrapper */
async function apiFetch(path, init) {
  const url = /^https?:\/\//i.test(path) ? path : joinUrl(API_BASE, path);
  const res = await fetch(url, { cache: 'no-store', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.detail || data?.error || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export default function AllContactsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [company, setCompany] = useState('');
  const [titleCSV, setTitleCSV] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;

  // Modal state — store the actual contact object (or null when closed)
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (company) params.set('company', company);
      if (titleCSV) params.set('title', titleCSV);
      params.set('page', String(page));
      params.set('limit', String(limit));
      params.set('ts', String(Date.now())); // cache buster
      const data = await apiFetch(`/contacts/list?${params.toString()}`);
      setItems(data?.items || []);
      setTotal(data?.total || 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener('contacts:refresh', handler);
    return () => window.removeEventListener('contacts:refresh', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function removeContact(id) {
    if (!id) return;
    if (!window.confirm('Delete this contact permanently?')) return;
    try {
      await apiFetch(`/contacts/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      alert(e?.message || 'Delete failed');
    }
  }

  const pages = Math.max(1, Math.ceil(total / limit));

  function applyFilters() {
    setPage(1);
    load();
  }
  function onKeyEnter(e) {
    if (e.key === 'Enter') applyFilters();
  }
  function handleEdited() {
    setEditing(null);
    load();
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-white/70" />
            <h1 className="text-2xl font-semibold tracking-tight">All Contacts</h1>
          </div>
          <Link
            href="/contacts"
            className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
          >
            Back
          </Link>
        </header>

        {/* Filters */}
        <section className="mb-4 rounded-2xl border border-white/10 bg-black/50 p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              value={search}
              onChange={setSearch}
              onKeyDown={onKeyEnter}
              placeholder="Search name, email, title, company…"
            />
            <Input
              value={company}
              onChange={setCompany}
              onKeyDown={onKeyEnter}
              placeholder="Filter by company"
            />
            <Input
              value={titleCSV}
              onChange={setTitleCSV}
              onKeyDown={onKeyEnter}
              placeholder="Filter titles (CSV e.g. CEO, CMO)"
            />
            <div className="md:col-span-3">
              <button
                onClick={applyFilters}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10"
              >
                Apply
              </button>
            </div>
          </div>
        </section>

        {/* Table */}
        <section className="rounded-2xl border border-white/10 bg-black/40 p-5">
          <div className="mb-4 text-sm font-medium text-white/80">
            Showing {items.length} of {total}
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="min-w-full bg-black text-sm">
              <thead className="bg-white/5 text-white/70">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Title</th>
                  <th className="px-4 py-3 text-left">Company</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">LinkedIn</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-white/60">
                      Loading…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-white/60">
                      No contacts.
                    </td>
                  </tr>
                ) : (
                  items.map((c) => {
                    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';
                    const companyName = c.co_name || c.company || '—';
                    return (
                      <tr key={c.id} className="border-t border-white/10">
                        <td className="px-4 py-3">{name}</td>
                        <td className="px-4 py-3">{c.title || '—'}</td>
                        <td className="px-4 py-3">{companyName}</td>
                        <td className="px-4 py-3">{c.email}</td>
                        <td className="px-4 py-3">
                          {c.linkedin_url ? (
                            <a
                              href={c.linkedin_url}
                              target="_blank"
                              rel="noreferrer"
                              className="underline decoration-white/40 hover:decoration-white"
                            >
                              Link
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => setEditing(c)}
                              className="inline-flex items-center gap-1 rounded-md border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </button>
                            <button
                              onClick={() => removeContact(c.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-3 flex items-center justify-between text-xs text-white/60">
            <div>Page {page} of {pages}</div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-white/20 px-2 py-1 disabled:opacity-50"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="rounded border border-white/20 px-2 py-1 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Inline modal (no portal/imports needed) */}
      {editing && (
        <EditContactModalInline
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={handleEdited}
        />
      )}
    </main>
  );
}

/* ===== helpers ===== */

function Input({ value, onChange, className = '', ...rest }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        'w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40 ' +
        className
      }
      {...rest}
    />
  );
}

/* ===== inline modal component ===== */
function EditContactModalInline({ contact, onClose, onSaved }) {
  const [firstName, setFirstName] = useState(contact.first_name || '');
  const [lastName, setLastName] = useState(contact.last_name || '');
  const [title, setTitle] = useState(contact.title || '');
  const [phone, setPhone] = useState(contact.phone || '');
  const [linkedinUrl, setLinkedinUrl] = useState(contact.linkedin_url || '');
  const [company, setCompany] = useState(contact.co_name || contact.company || '');
  const [companyDomain, setCompanyDomain] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      const data = await apiFetch(`/contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName || null,
          last_name: lastName || null,
          title: title || null,
          phone: phone || null,
          linkedin_url: linkedinUrl || null,
          company: company || null,
          companyDomain: companyDomain || null,
        }),
      });
      onSaved?.(data);
      onClose?.();
    } catch (e) {
      setMsg(e?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  // close on ESC
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-black p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-white/80">Edit contact</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name"
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
          />
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name"
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
          />
          <input
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="LinkedIn URL"
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40 md:col-span-2"
          />
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company"
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
          />
          <input
            value={companyDomain}
            onChange={(e) => setCompanyDomain(e.target.value)}
            placeholder="Company domain (optional)"
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
          />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {msg ? <span className="text-xs text-red-300">{msg}</span> : null}
        </div>
      </div>
    </div>
  );
}
