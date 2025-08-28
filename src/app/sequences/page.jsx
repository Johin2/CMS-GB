'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Loader2,
  Mail,
  Rocket,
  Wrench,
  FileCode2,
  Eye,
  Users,
  Settings,
  Upload,
  Image as ImageIcon,
  Trash2,
  Eraser,
} from 'lucide-react';

/* --- tiny client-side token filler for preview only --- */
function fillTokensLocal(template, vars) {
  if (!template) return '';
  let out = '';
  let i = 0;
  while (i < template.length) {
    const start = template.indexOf('{{', i);
    if (start === -1) { out += template.slice(i); break; }
    out += template.slice(i, start);
    const end = template.indexOf('}}', start + 2);
    if (end === -1) { out += template.slice(start); break; }
    const raw = template.slice(start + 2, end).trim();
    const parts = [];
    let buf = '';
    for (let k = 0; k < raw.length; k++) {
      const ch = raw[k];
      if (ch === '|') { parts.push(buf.trim()); buf = ''; }
      else { buf += ch; }
    }
    parts.push(buf.trim());
    const name = parts.shift() || '';
    let def;
    const transforms = [];
    for (const p of parts) {
      const low = p.toLowerCase();
      if (['upper', 'lower', 'title', 'trim'].includes(low)) transforms.push(low);
      else if (def === undefined) def = p;
    }
    let val = Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;
    if (val === undefined || val === null || val === '') val = def !== undefined ? def : '';
    let s = String(val);
    for (const t of transforms) {
      if (t === 'trim') s = s.trim();
      else if (t === 'upper') s = s.toUpperCase();
      else if (t === 'lower') s = s.toLowerCase();
      else if (t === 'title') {
        s = s.split(' ').map(w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');
      }
    }
    out += s;
    i = end + 2;
  }
  return out;
}

/* --- small utils for HTML injection / cleanup --- */
function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function injectBodyBackground(html, imageUrl) {
  if (!html) return html;
  const low = html.toLowerCase();
  const i = low.indexOf('<body');
  if (i === -1) return html;
  const j = low.indexOf('>', i);
  if (j === -1) return html;

  const before = html.slice(0, i);
  const bodyOpen = html.slice(i, j + 1);
  const after = html.slice(j + 1);

  const bgStyle = `background:#0b0b0b;background-image:url('${imageUrl}');background-size:cover;background-position:center;background-repeat:no-repeat;`;
  const hasStyle = bodyOpen.toLowerCase().includes('style=');
  let newBodyOpen = bodyOpen;

  if (hasStyle) {
    const si = bodyOpen.toLowerCase().indexOf('style=');
    const quote = bodyOpen[si + 6];
    const endQ = bodyOpen.indexOf(quote, si + 7);
    if (endQ > si) {
      const styleVal = bodyOpen.slice(si + 7, endQ);
      const merged = (styleVal.trim().endsWith(';') ? styleVal : styleVal + ';') + bgStyle;
      newBodyOpen =
        bodyOpen.slice(0, si) +
        `style=${quote}${merged}${quote}` +
        bodyOpen.slice(endQ + 1);
    }
  } else {
    const k = bodyOpen.lastIndexOf('>');
    newBodyOpen = bodyOpen.slice(0, k) + ` style="${bgStyle}"` + bodyOpen.slice(k);
  }

  return before + newBodyOpen + after;
}

function stripCssProps(styleStr, propsToStrip) {
  const pieces = styleStr.split(';');
  const kept = [];
  for (let piece of pieces) {
    const p = piece.trim();
    if (!p) continue;
    const colon = p.indexOf(':');
    if (colon === -1) { kept.push(p); continue; }
    const key = p.slice(0, colon).trim().toLowerCase();
    if (propsToStrip.includes(key)) continue;
    kept.push(p);
  }
  return kept.join('; ') + (kept.length ? ';' : '');
}

function stripBodyBackground(html) {
  if (!html) return html;
  const low = html.toLowerCase();
  const i = low.indexOf('<body');
  if (i === -1) return html;
  const j = low.indexOf('>', i);
  if (j === -1) return html;

  const before = html.slice(0, i);
  const bodyOpen = html.slice(i, j + 1);
  const after = html.slice(j + 1);

  const si = bodyOpen.toLowerCase().indexOf('style=');
  if (si === -1) return html; // no style to strip

  const quote = bodyOpen[si + 6];
  const endQ = bodyOpen.indexOf(quote, si + 7);
  if (endQ <= si) return html;

  const styleVal = bodyOpen.slice(si + 7, endQ);
  const newStyle = stripCssProps(styleVal, [
    'background-image',
    'background-size',
    'background-position',
    'background-repeat',
  ]);

  let newBodyOpen;
  if (!newStyle.trim()) {
    // remove style="" entirely
    newBodyOpen = bodyOpen.slice(0, si) + bodyOpen.slice(endQ + 1);
  } else {
    newBodyOpen = bodyOpen.slice(0, si) + `style=${quote}${newStyle}${quote}` + bodyOpen.slice(endQ + 1);
  }

  return before + newBodyOpen + after;
}

function heroBackgroundSnippet({ url, height, headline }) {
  const safeHeadline = escapeHtml(headline || '');
  const h = Math.max(120, Math.min(800, parseInt(height || '280', 10) || 280));
  return `
<!-- Hero background start -->
<table role="presentation" width="100%" style="max-width:640px;margin:0 auto;border-radius:12px;overflow:hidden;">
  <tr>
    <td style="padding:0;">
      <div style="background-image:url('${url}');background-size:cover;background-position:center;background-repeat:no-repeat;height:${h}px;">
        <div style="height:${h}px;background:linear-gradient(0deg, rgba(0,0,0,0.42), rgba(0,0,0,0.42));display:flex;align-items:flex-end;">
          <div style="padding:24px;font-family:Inter,Arial,sans-serif;color:#fff;font-size:24px;line-height:1.3;">${safeHeadline}</div>
        </div>
      </div>
    </td>
  </tr>
</table>
<!-- Hero background end -->
`;
}

function stripHeroBlocks(html, onlyUrl) {
  let s = String(html || '');
  const startTag = '<!-- Hero background start -->';
  const endTag = '<!-- Hero background end -->';

  let changed = false;
  while (true) {
    const i = s.indexOf(startTag);
    if (i === -1) break;
    const j = s.indexOf(endTag, i);
    if (j === -1) break;

    const blockEnd = j + endTag.length;
    const block = s.slice(i, blockEnd);
    if (!onlyUrl || block.includes(onlyUrl)) {
      s = s.slice(0, i) + s.slice(blockEnd);
      changed = true;
    } else {
      // skip this block; continue search after it
      const nextSearchFrom = blockEnd;
      const prefix = s.slice(0, nextSearchFrom);
      const suffix = s.slice(nextSearchFrom);
      // try to find next block in suffix
      const k = suffix.indexOf(startTag);
      if (k === -1) break;
      // rebuild string but keep going (loop will find it)
      s = prefix + suffix;
    }
  }
  return changed ? s : html;
}

function removeBgImageUrlOccurrences(html, url) {
  if (!html || !url) return html;
  // remove direct tokens we inserted
  let s = html;
  const patterns = [
    `background-image:url('${url}')`,
    `background-image:url("${url}")`,
    `background-image:url(${url})`,
  ];
  for (const p of patterns) {
    s = s.split(p).join('');
  }
  // cleanup possible duplicate semicolons like ;; and stray spaces
  s = s.replaceAll(';;', ';');
  return s;
}

export default function SequencesPage() {
  // shared
  const [contactEmail, setContactEmail] = useState('');
  const [note, setNote] = useState('');
  const [out, setOut] = useState(null);

  // setup helpers
  const [setupBusy, setSetupBusy] = useState(false);
  const [seqList, setSeqList] = useState(null);

  // sending state
  const [loading, setLoading] = useState(false);

  // tabs
  const [tab, setTab] = useState('sequence'); // 'sequence' | 'html'

  // sequence mode
  const [sequenceName, setSequenceName] = useState('Relationships - CEOs');
  const [stepOrder, setStepOrder] = useState(1);
  const [useAI, setUseAI] = useState(false);

  // html mode
  const [subjectOverride, setSubjectOverride] = useState('✨ Quick update for {{first_name|there}} at {{company}}');
  const [htmlBody, setHtmlBody] = useState(`<!doctype html>
<html>
  <body style="margin:0;padding:24px;font-family:Inter,Arial,sans-serif;line-height:1.5;background:#0b0b0b;color:#fff;">
    <table role="presentation" width="100%" style="max-width:640px;margin:0 auto;background:#111;border:1px solid #222;border-radius:12px;">
      <tr><td style="padding:24px;">
        <h2 style="margin:0 0 12px 0;font-weight:600;">Hi {{first_name|there}},</h2>
        <p style="margin:0 0 10px 0;">Quick one-pager on what we shipped in <b>{{month|this month}}</b> and the outcomes for peers in {{category|your category}}.</p>
        <p style="margin:0 0 14px 0;">
          <a href="https://example.com/one-pager" style="background:#fff;color:#000;text-decoration:none;padding:10px 14px;border-radius:8px;display:inline-block;">View the one-pager →</a>
        </p>
        <p style="margin:24px 0 0 0;color:#9aa0a6;">— {{sender_name|Team}}</p>
      </td></tr>
    </table>
  </body>
</html>`);
  const [varsJSON, setVarsJSON] = useState(`{
  "first_name": "Alicia",
  "company": "Globex",
  "month": "August",
  "category": "Leadership",
  "sender_name": "Outreach Bot"
}`);

  const parsedVars = useMemo(() => {
    try { return JSON.parse(varsJSON); } catch { return {}; }
  }, [varsJSON]);

  const previewHTML = useMemo(() => fillTokensLocal(htmlBody, parsedVars), [htmlBody, parsedVars]);
  const previewSubject = useMemo(() => fillTokensLocal(subjectOverride, parsedVars), [subjectOverride, parsedVars]);

  // images (HTML tab)
  const [uploadingImage, setUploadingImage] = useState(false);
  const [images, setImages] = useState([]); // [{url,name,size}]
  const [selectedImage, setSelectedImage] = useState(null);
  const [manualImageURL, setManualImageURL] = useState('');
  const [heroHeight, setHeroHeight] = useState('280');
  const [heroHeadline, setHeroHeadline] = useState('Your headline here');
  const fileInputRef = useRef(null);

  /* ---------- actions ---------- */
  async function seedDefaults() {
    setSetupBusy(true);
    setNote('');
    setSeqList(null);
    try {
      const res = await fetch('/api/sequences/seed', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Seed failed');
      setSequenceName('Relationships - CEOs');
      setStepOrder(1);
      setNote('Seeded default sequences.');
    } catch (e) {
      setNote(e?.message || 'Seed failed');
    } finally {
      setSetupBusy(false);
    }
  }

  async function checkSequences() {
    setSetupBusy(true);
    setNote('');
    try {
      const res = await fetch('/api/sequences/list', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'List failed');
      setSeqList(data);
      setNote('Fetched sequences.');
    } catch (e) {
      setNote(e?.message || 'List failed');
    } finally {
      setSetupBusy(false);
    }
  }

  async function sendSequenceNow() {
    setLoading(true);
    setOut(null);
    setNote('');
    try {
      const res = await fetch('/api/sequences/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactEmail,
          sequenceName,
          stepOrder,
          use_ai: useAI
        })
      });
      const data = await res.json();
      setOut(data);
      if (!res.ok) throw new Error(data?.error || 'Send failed');
      setNote(data?.status === 'queued' ? 'Queued (mock/test mode or provider error).' : 'Sent!');
    } catch (e) {
      setNote(e?.message || 'Send failed');
    } finally {
      setLoading(false);
    }
  }

  async function sendHtmlNow() {
    setLoading(true);
    setOut(null);
    setNote('');
    let vars = {};
    try { vars = JSON.parse(varsJSON || '{}'); } catch {}
    try {
      const res = await fetch('/api/sequences/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: contactEmail,
          subject_override: subjectOverride,
          html_override: htmlBody,
          vars
        })
      });
      const data = await res.json();
      setOut(data);
      if (!res.ok) throw new Error(data?.error || 'Send failed');
      setNote(data?.status === 'queued' ? 'Queued (mock/test mode or provider error).' : 'Sent!');
    } catch (e) {
      setNote(e?.message || 'Send failed');
    } finally {
      setLoading(false);
    }
  }

  async function onPickFile(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setNote('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/uploads', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Upload failed');
      const entry = { url: data.url, name: data.name || file.name, size: data.size || file.size || 0 };
      setImages(prev => [entry, ...prev]);
      setSelectedImage(entry);
      setNote('Image uploaded.');
    } catch (e) {
      setNote(e?.message || 'Upload failed');
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function addManualImage() {
    const u = manualImageURL.trim();
    if (!u) return;
    const entry = { url: u, name: u.split('/').pop() || 'image', size: 0 };
    setImages(prev => [entry, ...prev]);
    setSelectedImage(entry);
    setManualImageURL('');
  }

  function insertAsHeroBackground() {
    if (!selectedImage?.url) return;
    const snippet = heroBackgroundSnippet({
      url: selectedImage.url,
      height: heroHeight,
      headline: heroHeadline,
    });
    setHtmlBody(t => t + '\n' + snippet);
    setNote('Inserted a hero background block into your HTML.');
  }

  function setAsPageBackground() {
    if (!selectedImage?.url) return;
    setHtmlBody(t => injectBodyBackground(t, selectedImage.url));
    setNote('Set the image as the <body> background.');
  }

  // --- NEW: removal helpers
  function clearPageBackground() {
    setHtmlBody(t => {
      const next = stripBodyBackground(t);
      return next;
    });
    setNote('Cleared the <body> background image.');
  }

  function removeHeroSections(urlOnly) {
    setHtmlBody(t => stripHeroBlocks(t, urlOnly ? (selectedImage?.url || null) : null));
    setNote(urlOnly ? 'Removed hero sections using the selected image.' : 'Removed all hero sections.');
  }

  function removeSelectedImageEverywhere() {
    if (!selectedImage?.url) return;
    setHtmlBody(t => {
      let next = t;
      // remove page background occurrences of this URL
      next = removeBgImageUrlOccurrences(next, selectedImage.url);
      // also strip hero blocks that contain this URL
      next = stripHeroBlocks(next, selectedImage.url);
      // finally, clean up body style props if they’re empty now
      next = stripBodyBackground(next);
      return next;
    });
    setNote('Removed the selected image from the HTML.');
  }

  // gallery remove (list only)
  function removeImageByUrl(url) {
    setImages(prev => {
      const next = prev.filter(img => img.url !== url);
      if (selectedImage?.url === url) {
        setSelectedImage(next.length ? next[0] : null);
      }
      return next;
    });
  }

  function removeSelectedImageFromGallery() {
    if (!selectedImage?.url) return;
    removeImageByUrl(selectedImage.url);
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sequences & Email</h1>
            <p className="mt-1 text-sm text-white/60">
              Send a saved sequence step, or switch to custom HTML and send a fully designed email.
            </p>
            {note ? <p className="mt-2 text-xs text-white/60">{note}</p> : null}
          </div>
          <div className="flex gap-2">
            <Link
              href="/sequences/manage"
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
              title="Manage sequences"
            >
              <Settings className="h-4 w-4" />
              Manage
            </Link>
            <Link
              href="/contacts"
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
              title="Contacts"
            >
              <Users className="h-4 w-4" />
              Contacts
            </Link>
          </div>
        </header>

        {/* Setup box */}
        <section className="mb-4 rounded-2xl border border-white/10 bg-black/50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-black">
              <Wrench className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="font-medium">Setup</div>
              <div className="text-xs text-white/60">Seed default sequences or list what’s already in the DB.</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={seedDefaults}
                disabled={setupBusy}
                className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
              >
                {setupBusy ? 'Working…' : 'Seed default sequences'}
              </button>
              <button
                onClick={checkSequences}
                disabled={setupBusy}
                className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
              >
                {setupBusy ? 'Working…' : 'Check sequences'}
              </button>
            </div>
          </div>

          {seqList ? (
            <div className="mt-3">
              <div className="mb-1 text-xs text-white/60">Sequences snapshot</div>
              <pre className="max-h-72 overflow-auto rounded-xl border border-white/10 bg-black/70 p-3 text-xs text-white/80">
{JSON.stringify(seqList, null, 2)}
              </pre>
            </div>
          ) : null}
        </section>

        {/* Tabs */}
        <div className="mb-3 flex gap-2">
          <button
            onClick={() => setTab('sequence')}
            className={`rounded-lg px-3 py-2 text-sm border ${tab === 'sequence' ? 'border-white/80 bg-white/10' : 'border-white/20 hover:bg-white/10'}`}
          >
            Sequence Step
          </button>
          <button
            onClick={() => setTab('html')}
            className={`rounded-lg px-3 py-2 text-sm border ${tab === 'html' ? 'border-white/80 bg-white/10' : 'border-white/20 hover:bg-white/10'}`}
          >
            Custom HTML
          </button>
        </div>

        {/* Shared: recipient */}
        <section className="mb-4 rounded-2xl border border-white/10 bg-black/50 p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">Contact email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="ceo@acme.com"
                  className="w-full rounded-lg border border-white/10 bg-black px-9 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/30"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Sequence mode */}
        {tab === 'sequence' && (
          <section className="rounded-2xl border border-white/10 bg-black/50 p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">Sequence name</label>
                <input
                  value={sequenceName}
                  onChange={(e) => setSequenceName(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-white/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">Step order</label>
                <input
                  type="number"
                  value={stepOrder}
                  onChange={(e) => setStepOrder(parseInt(e.target.value || '1', 10))}
                  className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-white/30"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-white/80">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-white/20 bg-black text-white accent-white"
                    checked={useAI}
                    onChange={(e) => setUseAI(e.target.checked)}
                  />
                  Use GPT personalization
                </label>
              </div>
            </div>

            <div className="mt-4">
              <button
                onClick={sendSequenceNow}
                disabled={loading || !contactEmail.trim()}
                className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-black px-4 py-2 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                {loading ? 'Sending…' : 'Send this step now'}
              </button>
            </div>
          </section>
        )}

        {/* HTML mode */}
        {tab === 'html' && (
          <>
            <section className="rounded-2xl border border-white/10 bg-black/50 p-5">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">Subject</label>
                  <input
                    value={subjectOverride}
                    onChange={(e) => setSubjectOverride(e.target.value)}
                    placeholder="Subject"
                    className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-white/30"
                  />
                </div>

                <div className="md:col-span-1">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-white/60">HTML</span>
                    <FileCode2 className="h-4 w-4 text-white/50" />
                  </div>
                  <textarea
                    value={htmlBody}
                    onChange={(e) => setHtmlBody(e.target.value)}
                    placeholder="Paste your HTML here (tokens like {{first_name}} supported)"
                    className="h-[360px] w-full resize-y rounded-lg border border-white/10 bg-black p-3 text-xs outline-none placeholder:text-white/40 focus:border-white/30 font-mono"
                  />
                </div>

                <div className="md:col-span-1">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-white/60">Preview</span>
                    <Eye className="h-4 w-4 text-white/50" />
                  </div>
                  <div className="h-[360px] overflow-hidden rounded-lg border border-white/10 bg-black">
                    <iframe
                      title="email-preview"
                      className="h-full w-full"
                      srcDoc={previewHTML}
                    />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">
                    Variables (JSON) — used for preview and sent to the API
                  </label>
                  <textarea
                    value={varsJSON}
                    onChange={(e) => setVarsJSON(e.target.value)}
                    className="h-32 w-full resize-y rounded-lg border border-white/10 bg-black p-3 text-xs outline-none placeholder:text-white/40 focus:border-white/30 font-mono"
                  />
                </div>
              </div>

              <div className="mt-4">
                <button
                  onClick={sendHtmlNow}
                  disabled={loading || !contactEmail.trim()}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-black px-4 py-2 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  {loading ? 'Sending…' : 'Send HTML now'}
                </button>
                <div className="mt-2 text-xs text-white/50">
                  We’ll send HTML and auto-generate a plain-text fallback.
                </div>
                <div className="mt-1 text-xs text-white/40">
                  Supports tokens like <code className="font-mono">{'{{first_name}}'}</code>,{' '}
                  <code className="font-mono">{'{{company}}'}</code>,{' '}
                  <code className="font-mono">{'{{month|August}}'}</code> etc.
                </div>
              </div>
            </section>

            {/* Images section (upload + gallery + background helpers) */}
            <section className="mt-6 rounded-2xl border border-white/10 bg-black/50 p-5">
              <div className="mb-4 flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-white/70" />
                <div className="text-sm font-medium text-white/80">Images / Background</div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {/* Left: uploader + gallery */}
                <div className="md:col-span-2">
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 cursor-pointer">
                      <Upload className="h-4 w-4" />
                      <span>Upload image (host & use)</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={onPickFile}
                        className="hidden"
                      />
                    </label>

                    <div className="flex items-center gap-2">
                      <input
                        value={manualImageURL}
                        onChange={(e) => setManualImageURL(e.target.value)}
                        placeholder="Or paste an image URL…"
                        className="w-72 rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
                      />
                      <button
                        onClick={addManualImage}
                        disabled={!manualImageURL.trim()}
                        className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>

                    {uploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  </div>

                  {images.length ? (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      {images.map((img, i) => {
                        const active = selectedImage?.url === img.url;
                        return (
                          <div
                            key={`${img.url}-${i}`}
                            className={`group relative overflow-hidden rounded-md border ${active ? 'border-white/70' : 'border-white/10 hover:border-white/30'}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.url}
                              alt={img.name}
                              className="h-28 w-full cursor-pointer object-cover"
                              onClick={() => setSelectedImage(img)}
                            />

                            {/* REMOVE button on thumbnail (gallery only) */}
                            <button
                              onClick={(e) => { e.stopPropagation(); removeImageByUrl(img.url); }}
                              title="Remove from gallery"
                              className="absolute right-1 top-1 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-1 text-[11px] text-white opacity-0 shadow group-hover:opacity-100"
                            >
                              <Trash2 className="h-3 w-3" />
                              Remove
                            </button>

                            <div className="truncate px-2 py-1 text-[11px] text-white/70">{img.name}</div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-white/10 p-4 text-sm text-white/60">
                      No images yet. Upload a file or paste a URL.
                    </div>
                  )}
                </div>

                {/* Right: controls for background insertion & removal */}
                <div className="md:col-span-1">
                  <div className="mb-2 text-xs uppercase tracking-wide text-white/60">Background options</div>

                  <div className="mb-3">
                    <label className="mb-1 block text-xs text-white/60">Hero height (px)</label>
                    <input
                      type="number"
                      value={heroHeight}
                      onChange={(e) => setHeroHeight(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none"
                      placeholder="280"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="mb-1 block text-xs text-white/60">Hero headline</label>
                    <input
                      value={heroHeadline}
                      onChange={(e) => setHeroHeadline(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none"
                      placeholder="Your headline here"
                    />
                  </div>

                  <div className="overflow-hidden rounded-lg border border-white/10 bg-black/40">
                    {selectedImage?.url ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={selectedImage.url} alt={selectedImage.name} className="w-full object-contain" />
                        <div className="border-t border-white/10 p-3 text-xs">
                          <div className="truncate text-white/80">{selectedImage.name}</div>
                          <div className="mt-2 whitespace-pre-wrap break-all text-white/50">{selectedImage.url}</div>

                          <button
                            onClick={insertAsHeroBackground}
                            className="mt-3 w-full rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                          >
                            Insert as hero background
                          </button>
                          <button
                            onClick={setAsPageBackground}
                            className="mt-2 w-full rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                          >
                            Set as page background
                          </button>

                          {/* NEW removal controls that affect HTML */}
                          <div className="mt-3 grid gap-2">
                            <button
                              onClick={clearPageBackground}
                              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                              title="Strip background-image from <body> style"
                            >
                              <Eraser className="h-4 w-4" />
                              Clear page background
                            </button>

                            <button
                              onClick={() => removeHeroSections(true)}
                              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                              title="Remove hero sections that use this image"
                            >
                              <Trash2 className="h-4 w-4" />
                              Remove hero sections (this image)
                            </button>

                            <button
                              onClick={removeSelectedImageEverywhere}
                              className="inline-flex items-center justify-center gap-2 rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"
                              title="Remove this image from <body> background and hero blocks"
                            >
                              <Trash2 className="h-4 w-4" />
                              Remove image from HTML
                            </button>
                          </div>

                          {/* Gallery-only removal (doesn't change HTML) */}
                          <button
                            onClick={removeSelectedImageFromGallery}
                            className="mt-2 w-full rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                            title="Remove from gallery list (not HTML)"
                          >
                            Remove from gallery
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="p-4 text-sm text-white/60">
                        Pick an image to set as background or remove.
                        <div className="mt-2 grid gap-2">
                          <button
                            onClick={clearPageBackground}
                            className="inline-flex items-center justify-center gap-2 rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                            title="Strip background-image from <body> style"
                          >
                            <Eraser className="h-4 w-4" />
                            Clear page background
                          </button>
                          <button
                            onClick={() => removeHeroSections(false)}
                            className="inline-flex items-center justify-center gap-2 rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                            title="Remove all hero sections (no image selected)"
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove all hero sections
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {out && (
          <section className="mt-6 rounded-2xl border border-white/10 bg-black/50 p-5">
            <div className="mb-2 text-sm font-medium text-white/80">Response</div>
            <pre className="max-h-[480px] overflow-auto rounded-xl border border-white/10 bg-black/70 p-4 text-xs leading-relaxed text-white/80">
{JSON.stringify(out, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </main>
  );
}
