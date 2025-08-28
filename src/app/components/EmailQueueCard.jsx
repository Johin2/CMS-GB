'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Inbox, FileUp, Megaphone, Loader2 } from 'lucide-react';

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

function parseCSV(text) {
  // simple CSV parser: handles quotes and commas
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++; // CRLF
      row.push(field); rows.push(row); field = ''; row = []; i++; continue;
    }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(r => {
    const obj = {};
    for (let k = 0; k < header.length; k++) obj[header[k]] = r[k] ?? '';
    return obj;
  });
}

export default function EmailQueueCard({ queued = 0, onRefresh }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  function openPicker() {
    fileRef.current?.click();
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setNote('');
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (!rows.length) throw new Error('Empty or invalid CSV.');

      // Expect a column 'email' (case-insensitive). Optional: subject, html/text.
      const filtered = rows
        .map(r => ({
          email: r.email || r.to || r['to email'] || '',
          subject: r.subject || '',
          html: r.html || r['body html'] || '',
          text: r.text || r['body text'] || '',
        }))
        .filter(r => r.email && r.email.includes('@'));

      if (!filtered.length) throw new Error('No valid rows with an email column.');

      const res = await postJSON('/api/emails/outbox/import', {
        rows: filtered,
        send: false, // queue only; flip to true to send immediately
      });

      setNote(`Imported ${res.inserted} row(s). Queued: ${res.queued}${res.sent ? `, Sent: ${res.sent}` : ''}.`);
      onRefresh?.();
    } catch (err) {
      setNote(err.message || 'Import failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/90 text-black">
          <Inbox className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium">Email queue</div>
          <div className="text-xs text-white/60">emails waiting to send</div>
        </div>
        <div className="text-2xl font-semibold tabular-nums">{queued}</div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={openPicker}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          {busy ? 'Importing…' : 'Upload CSV'}
        </button>

        <Link
          href="/sequences?tab=html"
          className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
        >
          <Megaphone className="h-4 w-4" />
          Compose broadcast
        </Link>
      </div>

      {note ? <div className="mt-3 text-xs text-white/70">{note}</div> : null}

      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
    </div>
  );
}
