'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2,
  Globe,
  Filter,
  Send,
  UserPlus,
  Users,
  Trash2,
  X,
  Pencil,
} from 'lucide-react';

/* ---------- Mounted-safe Portal so the modal escapes containers ---------- */
function Portal({ children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

/** Resolve a fully-qualified API base:
 *  1) NEXT_PUBLIC_API_BASE if it starts with http(s)
 *  2) window.location.origin + /api (browser only)
 *  3) http://127.0.0.1:8000/api (fallback for dev/SSR)
 */
const API_BASE = (() => {
  const env = process.env.NEXT_PUBLIC_API_BASE;
  if (env && /^https?:\/\//i.test(env)) return env.replace(/\/+$/, '');
  if (typeof window !== 'undefined') return `${window.location.origin}/api`;
  return 'http://127.0.0.1:8000/api';
})();

/** Joins base + path safely without using URL(base) which throws on relative bases. */
function joinUrl(base, path) {
  return `${base.replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
}

/** Minimal fetch wrapper that always targets the FastAPI base. */
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

/* =========================
   Contacts Page (top-level)
   ========================= */
export default function ContactsPage() {
  const [domain, setDomain] = useState('');
  const [titles, setTitles] = useState('Chief Executive Officer, Chief Marketing Officer');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [note, setNote] = useState('');
  const [showAll, setShowAll] = useState(false);

  async function fetchContactsFromApollo() {
    setLoading(true);
    setResult(null);
    setNote('');
    try {
      const res = await fetch('/api/apollo/find-by-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          titles: titles.split(',').map((s) => s.trim()).filter(Boolean),
          perPage: 5,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Request failed');
      setResult(data);
      setNote(`Saved ${data.count ?? 0} contact(s) for ${domain}`);
      window.dispatchEvent(new CustomEvent('contacts:refresh'));
    } catch (e) {
      setNote(e?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
            <p className="mt-1 text-sm text-white/60">
              Pull leads by company domain, or add contacts manually without Apollo.
            </p>
            {note ? <p className="mt-2 text-xs text-white/60">{note}</p> : null}
          </div>
          <button
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-black px-4 py-2 text-sm hover:bg-white/10"
          >
            <Users className="h-4 w-4" />
            {showAll ? 'Hide all contacts' : 'Show all contacts'}
          </button>
        </header>

        {/* Manual Add Contact */}
        <AddContactForm
          onSaved={(c) => {
            setNote(
              `Saved contact: ${[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email}`
            );
            window.dispatchEvent(new CustomEvent('contacts:refresh'));
          }}
        />

        {/* Apollo fetch section */}
        <section className="mt-6 rounded-2xl border border-white/10 bg-black/50 p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="col-span-1">
              <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">
                Company domain
              </label>
              <div className="relative">
                <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="acme.com"
                  className="w-full rounded-lg border border-white/10 bg-black px-9 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/30"
                />
              </div>
            </div>

            <div className="col-span-1 md:col-span-2">
              <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">
                Titles (comma separated)
              </label>
              <div className="relative">
                <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  value={titles}
                  onChange={(e) => setTitles(e.target.value)}
                  placeholder="CEO, CMO, VP Marketing"
                  className="w-full rounded-lg border border-white/10 bg-black px-9 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/30"
                />
              </div>
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={fetchContactsFromApollo}
              disabled={loading || !domain.trim()}
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-black px-4 py-2 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {loading ? 'Fetching…' : 'Fetch from Apollo & Save'}
            </button>
          </div>
        </section>

        {result && (
          <section className="mt-6 rounded-2xl border border-white/10 bg-black/50 p-5">
            <div className="mb-2 text-sm font-medium text-white/80">Response</div>
            <pre className="max-h-[480px] overflow-auto rounded-xl border border-white/10 bg-black/70 p-4 text-xs leading-relaxed text-white/80">
              {JSON.stringify(result, null, 2)}
            </pre>
          </section>
        )}

        {showAll ? <AllContactsPanel onClose={() => setShowAll(false)} /> : null}
      </div>
    </main>
  );
}

/* =========================
   Manual Add subcomponent
   ========================= */
function AddContactForm({ onSaved }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [companyDomain, setCompanyDomain] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const emailOk = /\S+@\S+\.\S+/.test(email);

  async function save() {
    setLoading(true);
    setMsg('');
    try {
      const data = await apiFetch('/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          title,
          phone: phone || undefined,
          company: company || undefined,
          companyDomain: companyDomain || undefined,
          linkedinUrl: linkedinUrl || undefined,
        }),
      });
      setMsg(data.created ? 'Contact added.' : 'Contact updated.');
      onSaved?.(data.contact);
      setFirstName('');
      setLastName('');
      setEmail('');
      setTitle('');
      setPhone('');
      setCompany('');
      setCompanyDomain('');
      setLinkedinUrl('');
    } catch (e) {
      setMsg(e?.message || 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-black/50 p-5">
      <div className="mb-3 flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-white/70" />
        <div className="text-sm font-medium text-white/80">Add contact manually</div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <TextInput label="First name" value={firstName} onChange={setFirstName} placeholder="Alicia" />
        <TextInput label="Last name" value={lastName} onChange={setLastName} placeholder="Ng" />
        <TextInput label="Email *" value={email} onChange={setEmail} placeholder="alicia@globex.com" />
        <TextInput label="Title" value={title} onChange={setTitle} placeholder="Chief Marketing Officer" />
        <TextInput label="Phone" value={phone} onChange={setPhone} placeholder="+91 98765 43210" />
        <TextInput label="LinkedIn URL" value={linkedinUrl} onChange={setLinkedinUrl} placeholder="https://linkedin.com/in/…" />
        <TextInput label="Company" value={company} onChange={setCompany} placeholder="Globex" />
        <TextInput label="Company domain" value={companyDomain} onChange={setCompanyDomain} placeholder="globex.com" />
      </div>

      <div className="mt-4">
        <button
          onClick={save}
          disabled={loading || !emailOk}
          className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-black px-4 py-2 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          {loading ? 'Saving…' : 'Add contact'}
        </button>
        {msg ? <span className="ml-3 text-sm text-white/70">{msg}</span> : null}
      </div>
    </section>
  );
}

/* =========================
   All contacts panel (list) + Edit modal
   ========================= */
function AllContactsPanel({ onClose }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [company, setCompany] = useState('');
  const [titleCSV, setTitleCSV] = useState('');
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState(null); // <-- holds the selected contact
  const limit = 50;

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (company) params.set('company', company);
      if (titleCSV) params.set('title', titleCSV);
      params.set('page', String(page));
      params.set('limit', String(limit));
      params.set('ts', String(Date.now()));
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
  function onEdited() {
    setEditing(null);
    load();
  }

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm font-medium text-white/80">All contacts ({total})</div>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-black px-3 py-1.5 text-xs hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" />
          Close
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 grid gap-3 md:grid-cols-3">
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

      {/* Table */}
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
                          onClick={() => setEditing(c)} // <-- directly open modal
                          className="inline-flex items-center gap-1 rounded-md border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          onClick={() => removeContact(c.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                          title="Delete"
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
        <div>
          Page {page} of {Math.max(1, Math.ceil(total / limit))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded border border-white/20 px-2 py-1 disabled:opacity-50"
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(Math.max(1, Math.ceil(total / limit)), p + 1))}
            disabled={page >= Math.max(1, Math.ceil(total / limit))}
            className="rounded border border-white/20 px-2 py-1 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {/* EDIT MODAL */}
      {editing ? (
        <Portal>
          <EditContactDialog
            contact={editing}
            onClose={() => setEditing(null)}
            onSaved={onEdited}
          />
        </Portal>
      ) : null}
    </section>
  );
}

/* =========================
   Edit dialog (modal)
   ========================= */
function EditContactDialog({ contact, onClose, onSaved }) {
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
      // use snake_case to match FastAPI payload handling
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
          companyDomain: companyDomain || null, // accepted by backend
        }),
      });
      onSaved?.(data);
    } catch (e) {
      setMsg(e?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-black p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium">Edit contact</div>
          <button
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
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
          >
            Close
          </button>
          {msg ? <span className="text-xs text-red-300">{msg}</span> : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------
   Small UI helpers
-------------------------- */
function TextInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">
        {label}
      </label>
      <input
        className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/30"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
function Input(props) {
  return (
    <input
      {...props}
      className={
        'w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40 ' +
        (props.className || '')
      }
    />
  );
}
