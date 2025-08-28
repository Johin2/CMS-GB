// src/app/contacts/components/EditContactModal.jsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, X } from 'lucide-react';

/** API base setup */
const API_BASE = (() => {
  const env = process.env.NEXT_PUBLIC_API_BASE;
  if (env && /^https?:\/\//i.test(env)) return env.replace(/\/+$/, '');
  if (typeof window !== 'undefined') return `${window.location.origin}/api`;
  return 'http://127.0.0.1:8000/api';
})();
const joinUrl = (base, path) =>
  `${base.replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;

async function apiFetch(path, init) {
  const url = /^https?:\/\//i.test(path) ? path : joinUrl(API_BASE, path);
  const res = await fetch(url, { cache: 'no-store', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.error || `Request failed: ${res.status}`);
  return data;
}

export default function EditContactModal({ contact, onClose, onSaved }) {
  const [firstName, setFirstName]   = useState('');
  const [lastName, setLastName]     = useState('');
  const [title, setTitle]           = useState('');
  const [phone, setPhone]           = useState('');
  const [company, setCompany]       = useState('');
  const [companyDomain, setCompanyDomain] = useState('');
  const [linkedinUrl, setLinkedinUrl]     = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Prefill fields when a contact is provided
  useEffect(() => {
    if (!contact) return;
    setFirstName(contact.first_name || '');
    setLastName(contact.last_name || '');
    setTitle(contact.title || '');
    setPhone(contact.phone || '');
    setCompany(contact.company || contact.co_name || '');
    setLinkedinUrl(contact.linkedin_url || '');
    setCompanyDomain('');
  }, [contact]);

  // Close on Esc
  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose?.();
    },
    [onClose]
  );
  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  async function save() {
    if (!contact?.id) return;
    setSaving(true);
    setMsg('');
    try {
      const payload = {
        // snake_case to match FastAPI
        first_name: firstName || null,
        last_name: lastName || null,
        title: title || null,
        phone: phone || null,
        linkedin_url: linkedinUrl || null,
        company: company || null,
        companyDomain: companyDomain || null,
      };
      const data = await apiFetch(`/contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      onSaved?.(data);
      onClose?.();
    } catch (e) {
      setMsg(e?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  // Stop click events from closing when clicking inside the sheet
  function stop(e) {
    e.stopPropagation();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-5 text-white shadow-2xl"
        onClick={stop}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Edit contact</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-white hover:bg-neutral-50"
            aria-label="Close"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Form */}
        <div className="grid gap-3 md:grid-cols-2">
          <LabeledInput
            label="First name"
            value={firstName}
            onChange={setFirstName}
            placeholder="Jane"
          />
          <LabeledInput
            label="Last name"
            value={lastName}
            onChange={setLastName}
            placeholder="Doe"
          />
          <LabeledInput
            label="Title"
            value={title}
            onChange={setTitle}
            placeholder="Chief Marketing Officer"
          />
          <LabeledInput
            label="Phone"
            value={phone}
            onChange={setPhone}
            placeholder="+1 555 123 4567"
          />
          <LabeledInput
            className="md:col-span-2"
            label="LinkedIn URL"
            value={linkedinUrl}
            onChange={setLinkedinUrl}
            placeholder="https://linkedin.com/in/…"
          />
          <LabeledInput
            label="Company"
            value={company}
            onChange={setCompany}
            placeholder="Globex"
          />
          <LabeledInput
            label="Company domain (optional)"
            value={companyDomain}
            onChange={setCompanyDomain}
            placeholder="globex.com"
          />
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm text-white hover:bg-neutral-50 disabled:opacity-60"
          >
            Close
          </button>
          {msg ? <span className="ml-2 text-xs text-red-600">{msg}</span> : null}
        </div>
      </div>
    </div>
  );
}

/* ---------- Small labeled input helper (light theme) ---------- */
function LabeledInput({ label, value, onChange, placeholder, className = '' }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-600">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-white placeholder:text-neutral-400 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
      />
    </div>
  );
}
