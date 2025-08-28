// app/news/page.jsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Search, ChevronDown, ChevronRight, Check, Pencil, X, Save, RotateCcw } from 'lucide-react';

/* ---------------------------
   API helper
   Always call the Next.js proxy at /api
---------------------------- */
const API_BASE = '/api';

const joinUrl = (base, path) =>
  `${base.replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;

async function apiFetch(path, init) {
  const url = /^https?:\/\//i.test(path) ? path : joinUrl(API_BASE, path);
  const res = await fetch(url, { cache: 'no-store', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.error || `Request failed: ${res.status}`);
  return data;
}

/* ---------------------------
   Text helpers (token aware)
---------------------------- */
const tok = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9+]+/i)
    .filter(Boolean);

const hasAny = (s, ...needles) => {
  const t = tok(s);
  return needles.some((n) => t.includes(n.toLowerCase()));
};

const contains = (s, needle) => (s || '').toLowerCase().includes((needle || '').toLowerCase());

function capFirstAlpha(v) {
  if (v === null || v === undefined) return '—';
  const s = String(v);
  if (s.trim() === '') return '—';
  const idx = s.search(/[A-Za-z]/);
  if (idx === -1) return s;
  return s.slice(0, idx) + s[idx].toUpperCase() + s.slice(idx + 1);
}

/* ---------------------------
   Date helpers
---------------------------- */
function parseDateString(s) {
  if (!s) return 0;
  const m = String(s).match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{2,4})$/);
  if (m) {
    let yy = m[3];
    if (yy.length === 2) yy = '20' + yy;
    const t = Date.parse(`${m[1]} ${m[2]} ${yy}`);
    return Number.isNaN(t) ? 0 : t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}
function monthFromDateString(s) {
  const t = parseDateString(s);
  if (!t) return '';
  const d = new Date(t);
  return d.toLocaleString('en-US', { month: 'long' });
}

/* ---------------------------
   Buckets
---------------------------- */
const CORE_BUCKETS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'ceo', label: 'CEO', match: (r) => hasAny(r.designation, 'ceo') || contains(r.designation, 'chief executive') },
  { key: 'cmo', label: 'CMO', match: (r) => hasAny(r.designation, 'cmo') || contains(r.designation, 'chief marketing') },
  {
    key: 'cxo',
    label: 'CXO',
    match: (r) => {
      const t = tok(r.designation);
      const isChief =
        t.includes('chief') &&
        (t.includes('officer') ||
          t.includes('operating') ||
          t.includes('finance') ||
          t.includes('information') ||
          t.includes('technology') ||
          t.includes('growth') ||
          t.includes('people') ||
          t.includes('human')) &&
        !t.includes('marketing');
      const cxoTokens = ['coo', 'cfo', 'cto', 'cio', 'chro', 'cgo', 'cpo'];
      const isAbbrev = cxoTokens.some((x) => t.includes(x));
      return isChief || isAbbrev;
    },
  },
  { key: 'director', label: 'Director', match: (r) => hasAny(r.designation, 'director') },
  {
    key: 'country-head',
    label: 'Country Head',
    match: (r) => /country head|india head|regional head|head of india/.test((r.designation || '').toLowerCase()),
  },
  { key: 'fundings', label: 'Fundings', match: (r) => (r.type || '').toLowerCase().includes('fund') },
  { key: 'campaign', label: 'Campaign', match: (r) => (r.type || '').toLowerCase().includes('campaign') || hasAny(r.designation, 'campaign') },
];

const BUCKETS = [
  ...CORE_BUCKETS,
  { key: 'others', label: 'Others', match: (r) => !CORE_BUCKETS.slice(1).some((b) => b.match(r)) },
];

const DEFAULT_BUCKET = 'all';

/* ---------------------------
   Funding rounds
---------------------------- */
const FUNDING_ROUNDS = [
  { key: 'all', label: 'All' },
  { key: 'seed', label: 'Seed' },
  { key: 'angel', label: 'Angel' },
  { key: 'series a', label: 'Series A' },
  { key: 'series b', label: 'Series B' },
  { key: 'series c', label: 'Series C' },
  { key: 'others', label: 'Others' },
];

function normalizeRound(s) {
  const v = (s || '').toLowerCase();
  if (!v) return '';
  if (v.includes('seed')) return 'seed';
  if (v.includes('angel')) return 'angel';
  if (v.includes('series a')) return 'series a';
  if (v.includes('series b')) return 'series b';
  if (v.includes('series c')) return 'series c';
  return 'others';
}

/* ---------------------------
   Nested menu
---------------------------- */
const NESTED_BUCKET_MENU = [
  { key: 'all', label: 'All' },
  {
    label: 'Leadership',
    children: [
      { key: 'ceo', label: 'CEO' },
      { key: 'cmo', label: 'CMO' },
      { key: 'cxo', label: 'CXO' },
      { key: 'director', label: 'Director' },
      { key: 'country-head', label: 'Country Head' },
    ],
  },
  {
    label: 'Company',
    children: [
      { label: 'Fundings', key: 'fundings', children: FUNDING_ROUNDS.map((r) => ({ ...r, bucketKey: 'fundings' })) },
      { key: 'campaign', label: 'Campaign' },
    ],
  },
  { key: 'others', label: 'Others' },
];

/* ---------------------------
   UI
---------------------------- */
export default function NewsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [bucket, setBucket] = useState(DEFAULT_BUCKET);
  const [fundingRound, setFundingRound] = useState('all');

  const [editKey, setEditKey] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const query = params.toString();
      const data = await apiFetch(`api/news/table${query ? `?${query}` : ''}`);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      console.error(e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply() { load(); }

  const filtered = useMemo(() => {
    const rule = BUCKETS.find((b) => b.key === bucket)?.match || (() => true);
    let arr = items.filter((r) => rule(r));
    if (bucket === 'fundings') {
      const want = fundingRound;
      if (want && want !== 'all') arr = arr.filter((r) => normalizeRound(r.round) === want);
    }
    return [...arr].sort((a, b) => parseDateString(b.date) - parseDateString(a.date));
  }, [items, bucket, fundingRound]);

  const isFundingView = bucket === 'fundings';
  const activeBucketLabel = (() => {
    const base = BUCKETS.find((b) => b.key === bucket)?.label || 'Bucket';
    if (bucket === 'fundings') {
      const r = FUNDING_ROUNDS.find((x) => x.key === fundingRound)?.label || 'All';
      return r === 'All' ? base : `${base} • ${r}`;
    }
    return base;
  })();

  const startEdit = (row) => { setEditKey(row.link); setDraft({ ...row }); setMsg(''); };
  const cancelEdit = () => { setEditKey(null); setDraft(null); setMsg(''); };
  const updateDraft = (field, value) => { setDraft((d) => ({ ...d, [field]: value })); };

  const saveEdit = async () => {
    if (!draft?.link) return;
    const finalDate = draft.date || '';
    const finalMonth = finalDate ? monthFromDateString(finalDate) : draft.month || '';
    const payload = { url: draft.link, type: draft.type };
    if ((draft.type || '').toLowerCase().includes('fund')) {
      payload.company = (draft.company || '').trim() || null;
      payload.amount = (draft.amount || '').trim() || null;
      payload.round = (draft.round || '').trim() || null;
      payload.investors = (draft.investors || '').trim() || null;
      payload.date = finalDate || null;
      payload.month = finalMonth || null;
    } else {
      payload.name = (draft.name || '').trim() || null;
      payload.company = (draft.company || '').trim() || null;
      payload.designation = (draft.designation || '').trim() || null;
      payload.date = finalDate || null;
      payload.month = finalMonth || null;
    }
    try {
      setSaving(true);
      await apiFetch('/overrides/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setItems((prev) => prev.map((it) => (it.link === draft.link ? { ...it, ...draft, month: finalMonth } : it)));
      setMsg('Saved');
      setEditKey(null);
      setDraft(null);
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Save failed');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 2000);
    }
  };

  const clearOverride = async (row) => {
    if (!row?.link) return;
    try {
      setSaving(true);
      await apiFetch(`/overrides/one?url=${encodeURIComponent(row.link)}`, { method: 'DELETE' });
      setMsg('Override cleared');
      await load();
      setEditKey(null);
      setDraft(null);
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Clear failed');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 2000);
    }
  };

  const colCount = isFundingView ? 9 : 8;

  return (
    <main className="min-h-screen bg-[#0b0b0c] text-white">
      <div className="mx-auto max-w-7xl px-6 pb-16 pt-8">
        <h1 className="text-3xl font-semibold tracking-tight">News</h1>
        <p className="mt-2 text-sm text-white/60">
          Use the nested dropdown to filter buckets. Click <em>Edit</em> to fix data inline.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <BucketDropdown
            menu={NESTED_BUCKET_MENU}
            value={{ bucket, fundingRound }}
            onChange={(sel) => {
              if (sel.bucket === 'fundings' && sel.round) {
                setBucket('fundings');
                setFundingRound(sel.round);
              } else {
                setBucket(sel.bucket);
                if (sel.bucket !== 'fundings') setFundingRound('all');
              }
            }}
            buttonLabel={activeBucketLabel}
          />

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <FieldWrapper icon={<Calendar className="h-4 w-4 text-white/40" />}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 bg-transparent text-sm outline-none placeholder:text-white/40" />
            </FieldWrapper>
            <FieldWrapper icon={<Calendar className="h-4 w-4 text-white/40" />}>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 bg-transparent text-sm outline-none placeholder:text-white/40" />
            </FieldWrapper>
            <FieldWrapper icon={<Search className="h-4 w-4 text-white/40" />}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-52 bg-transparent text-sm outline-none placeholder:text-white/40" />
            </FieldWrapper>
            <button onClick={apply} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90">
              Apply
            </button>
          </div>
        </div>

        {msg ? <div className="mt-3 text-sm text-white/80">{msg}</div> : null}

        <section className="mt-6 rounded-2xl border border-white/10 bg-black/40">
          <div className="overflow-x-auto rounded-2xl">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-white/70">
                <tr>
                  <Th>Company</Th>
                  {!isFundingView && <Th>Name</Th>}
                  {!isFundingView && <Th>Designation</Th>}
                  {isFundingView && <Th>Amount</Th>}
                  {isFundingView && <Th>Round</Th>}
                  {isFundingView && <Th>Investors</Th>}
                  <Th>Date</Th>
                  <Th>Month</Th>
                  <Th>Link</Th>
                  <Th className="w-40">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <RowEmpty colSpan={colCount} text="Loading…" />
                ) : filtered.length === 0 ? (
                  <RowEmpty colSpan={colCount} text="No results." />
                ) : (
                  filtered.map((r, i) => {
                    const isEditing = editKey === r.link;
                    const row = isEditing ? draft : r;
                    const funding = (row.type || '').toLowerCase().includes('fund');

                    return (
                      <tr key={r.link || i} className={'border-t border-white/10 ' + (isEditing ? 'bg-white/[0.04]' : '')}>
                        <Td>
                          {isEditing ? (
                            <input value={row.company || ''} onChange={(e) => updateDraft('company', e.target.value)} className="w-56 rounded-md border border-white/20 bg-black px-2 py-1" placeholder="Company" />
                          ) : (
                            capFirstAlpha(row.company || '—')
                          )}
                        </Td>

                        {!funding && (
                          <Td>
                            {isEditing ? (
                              <input value={row.name || ''} onChange={(e) => updateDraft('name', e.target.value)} className="w-44 rounded-md border border-white/20 bg-black px-2 py-1" placeholder="Name" />
                            ) : (
                              capFirstAlpha(row.name || '—')
                            )}
                          </Td>
                        )}

                        {!funding && (
                          <Td>
                            {isEditing ? (
                              <input value={row.designation || ''} onChange={(e) => updateDraft('designation', e.target.value)} className="w-60 rounded-md border border-white/20 bg-black px-2 py-1" placeholder="Designation" />
                            ) : (
                              capFirstAlpha(row.designation || '—')
                            )}
                          </Td>
                        )}

                        {funding && (
                          <Td>
                            {isEditing ? (
                              <input value={row.amount || ''} onChange={(e) => updateDraft('amount', e.target.value)} className="w-28 rounded-md border border-white/20 bg-black px-2 py-1" placeholder="$1.5M / INR 20 crore" />
                            ) : (
                              capFirstAlpha(row.amount || '—')
                            )}
                          </Td>
                        )}

                        {funding && (
                          <Td>
                            {isEditing ? (
                              <input value={row.round || ''} onChange={(e) => updateDraft('round', e.target.value)} className="w-36 rounded-md border border-white/20 bg-black px-2 py-1" placeholder="Seed / Series A / Funding" />
                            ) : (
                              capFirstAlpha(row.round || '—')
                            )}
                          </Td>
                        )}

                        {funding && (
                          <Td>
                            {isEditing ? (
                              <input value={row.investors || ''} onChange={(e) => updateDraft('investors', e.target.value)} className="w-60 rounded-md border border-white/20 bg-black px-2 py-1" placeholder="Lead investors" />
                            ) : (
                              capFirstAlpha(row.investors || '—')
                            )}
                          </Td>
                        )}

                        <Td>
                          {isEditing ? (
                            <input type="text" value={row.date || ''} onChange={(e) => updateDraft('date', e.target.value)} className="w-32 rounded-md border border-white/20 bg-black px-2 py-1" placeholder="16-Jan-25 or 2025-01-16" />
                          ) : (
                            capFirstAlpha(row.date || '—')
                          )}
                        </Td>

                        <Td>{capFirstAlpha(row.month || monthFromDateString(row.date) || '—')}</Td>

                        <Td>
                          {row.link ? (
                            <a href={row.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-white/40 hover:decoration-white">
                              Link <ExternalIcon />
                            </a>
                          ) : (
                            '—'
                          )}
                        </Td>

                        <Td>
                          {!isEditing ? (
                            <div className="flex items-center gap-2">
                              <button onClick={() => startEdit(r)} className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 hover:bg-white/10" title="Edit">
                                <Pencil className="h-4 w-4" />
                                Edit
                              </button>
                              <button onClick={() => clearOverride(r)} className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white/80 hover:bg-white/10" title="Clear override">
                                <RotateCcw className="h-4 w-4" />
                                Reset
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button disabled={saving} onClick={saveEdit} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-black hover:bg-white/90 disabled:opacity-60" title="Save">
                                <Save className="h-4 w-4" />
                                Save
                              </button>
                              <button disabled={saving} onClick={cancelEdit} className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 hover:bg-white/10 disabled:opacity-60" title="Cancel">
                                <X className="h-4 w-4" />
                                Cancel
                              </button>
                            </div>
                          )}
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function FieldWrapper({ icon, children }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/20 bg-black px-3 py-2">
      {icon}
      {children}
    </div>
  );
}
function Th({ children, className = '' }) { return <th className={`px-4 py-3 text-left font-medium ${className}`}>{children}</th>; }
function Td({ children }) { return <td className="px-4 py-3 align-top">{children}</td>; }
function RowEmpty({ colSpan, text }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-white/60">{text}</td>
    </tr>
  );
}
function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

/* -------- Dropdown components (unchanged structure) -------- */
function BucketDropdown({ menu, value, onChange, buttonLabel }) {
  const [open, setOpen] = useState(false);
  const [hoverPath, setHoverPath] = useState([]);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    function onDocClick(e) {
      if (!open) return;
      const inBtn = btnRef.current?.contains(e.target);
      const inMenu = menuRef.current?.contains(e.target);
      if (!inBtn && !inMenu) { setOpen(false); setHoverPath([]); }
    }
    function onEsc(e) { if (e.key === 'Escape') { setOpen(false); setHoverPath([]); } }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  const selectBucketOnly = (bucketKey) => { onChange?.({ bucket: bucketKey }); setOpen(false); setHoverPath([]); };
  const selectFundingRound = (roundKey) => { onChange?.({ bucket: 'fundings', round: roundKey }); setOpen(false); setHoverPath([]); };

  const isActiveBucket = (key) => value?.bucket === key;
  const isActiveRound = (roundKey) => value?.bucket === 'fundings' && value?.fundingRound === roundKey;

  return (
    <div className="relative inline-block text-left">
      <button ref={btnRef} onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-black px-3 py-2 text-sm hover:bg-white/10">
        <span className="text-white/80">Bucket:</span>
        <span className="font-medium">{buttonLabel}</span>
        <ChevronDown className="h-4 w-4 opacity-60" />
      </button>

      {open && (
        <div ref={menuRef} className="absolute left-0 z-20 mt-2 rounded-xl border border-white/15 bg-black/95 p-1 shadow-xl backdrop-blur">
          <MenuLevel
            items={menu}
            level={0}
            leftOffset={0}
            onHoverPathChange={setHoverPath}
            hoverPath={hoverPath}
            onSelectBucket={selectBucketOnly}
            onSelectFundingRound={selectFundingRound}
            isActiveBucket={isActiveBucket}
            isActiveRound={isActiveRound}
          />
        </div>
      )}
    </div>
  );
}

function MenuLevel({ items, level, leftOffset, hoverPath, onHoverPathChange, onSelectBucket, onSelectFundingRound, isActiveBucket, isActiveRound }) {
  return (
    <div className="relative w-64 rounded-xl border border-white/15 bg-black/95 p-1" style={{ marginLeft: leftOffset }}>
      <ul className="py-1">
        {items.map((item, idx) => {
          const pathMatch = hoverPath[level] === idx;
          const hasChildren = Array.isArray(item.children) && item.children.length > 0;
          const isFundingRoundChild = item.bucketKey === 'fundings' && !hasChildren && item.key;

          return (
            <li key={(item.key || item.label) + '-' + idx} className="relative"
                onMouseEnter={() => onHoverPathChange([...hoverPath.slice(0, level), idx])}>
              <button
                onClick={() => {
                  if (hasChildren) return;
                  if (isFundingRoundChild) onSelectFundingRound(item.key);
                  else if (item.key) onSelectBucket(item.key);
                }}
                className={
                  'group flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-white/10 ' +
                  ((item.key && !hasChildren && isActiveBucket(item.key)) || (isFundingRoundChild && isActiveRound(item.key)) ? 'bg-white/10' : '')
                }
              >
                <span className="text-white/90">{item.label}</span>
                {hasChildren ? (
                  <ChevronRight className="h-4 w-4 opacity-70" />
                ) : (item.key && isActiveBucket(item.key)) || (isFundingRoundChild && isActiveRound(item.key)) ? (
                  <Check className="h-4 w-4 opacity-80" />
                ) : null}
              </button>

              {hasChildren && pathMatch && (
                <div className="absolute left-full top-0 z-30 ml-1">
                  <MenuLevel
                    items={item.children}
                    level={level + 1}
                    leftOffset={0}
                    hoverPath={hoverPath}
                    onHoverPathChange={onHoverPathChange}
                    onSelectBucket={onSelectBucket}
                    onSelectFundingRound={onSelectFundingRound}
                    isActiveBucket={isActiveBucket}
                    isActiveRound={isActiveRound}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
