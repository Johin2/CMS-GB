'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Save, Loader2, Rocket, Users, MailPlus,
  CheckCircle2, XCircle, ChevronDown, ChevronUp, Wand2, Trash2
} from 'lucide-react';

/* =========================================================
   Top-level Marketing page
========================================================= */
export default function MarketingPage() {
  const [tab, setTab] = useState('campaigns'); // campaigns | enroll | scheduler

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl p-6 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Marketing Automation</h1>
            <p className="mt-1 text-sm text-white/60">Journeys, enrollments, and scheduler.</p>
          </div>

          <div className="inline-flex overflow-hidden rounded-xl border border-white/15">
            {['campaigns', 'enroll', 'scheduler'].map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-4 py-2 text-sm ${tab === k ? 'bg-white/10' : 'bg-black hover:bg-white/5'} border-l border-white/10 first:border-l-0`}
              >
                {k === 'campaigns' ? 'Campaigns' : k === 'enroll' ? 'Enroll' : 'Scheduler'}
              </button>
            ))}
          </div>
        </header>

        {tab === 'campaigns' && <CampaignsPanel />}
        {tab === 'enroll' && <EnrollPanel />}
        {tab === 'scheduler' && <SchedulerPanel />}
      </div>
    </main>
  );
}

/* =========================================================
   Campaigns: list & create
========================================================= */
function CampaignsPanel() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ campaigns: [], steps: [] });
  const [openCreate, setOpenCreate] = useState(false);
  const [note, setNote] = useState('');

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/marketing/campaigns', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Failed to load campaigns');
      setData({ campaigns: j.campaigns || [], steps: j.steps || [] });
    } catch (e) {
      setNote(String(e?.message || 'Load failed'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Campaigns</h2>
          {note ? <p className="mt-1 text-xs text-white/60">{note}</p> : null}
        </div>
        <button
          onClick={() => setOpenCreate(v => !v)}
          className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10"
        >
          <Plus className="h-4 w-4" />
          {openCreate ? 'Hide create form' : 'Create campaign'}
        </button>
      </div>

      {openCreate && <CreateCampaignForm onCreated={() => { setOpenCreate(false); load(); }} />}

      <div className="overflow-hidden rounded-2xl border border-white/10">
        <table className="min-w-full bg-black text-sm">
          <thead className="bg-white/5 text-white/70">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Steps</th>
              <th className="px-4 py-3 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-white/60">Loading…</td></tr>
            ) : data.campaigns.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-white/60">No campaigns yet.</td></tr>
            ) : (
              data.campaigns.map((c) => {
                const steps = (data.steps || []).filter(s => s.campaign_id === c.id).sort((a,b)=>a.step_order-b.step_order);
                return (
                  <tr key={c.id} className="border-t border-white/10 align-top">
                    <td className="px-4 py-3">{c.name}</td>
                    <td className="px-4 py-3 text-white/80">{c.description || '—'}</td>
                    <td className="px-4 py-3">{c.status || 'active'}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-2">
                        {steps.map(s => (
                          <div key={s.id} className="rounded-lg border border-white/10 p-3">
                            <div className="text-xs text-white/60">Step {s.step_order} • Delay {s.delay_minutes}m</div>
                            <div className="mt-1 text-sm">
                              <div className="font-medium">A: {s.subject || '—'}</div>
                              <div className="text-white/70 whitespace-pre-wrap">{s.body || '—'}</div>
                              {(s.subject_b || s.body_b) ? (
                                <div className="mt-2 rounded-md border border-white/10 p-2">
                                  <div className="text-xs text-white/60">Variant B (weight {s.weight_b ?? 0}%)</div>
                                  <div className="font-medium">B: {s.subject_b || '—'}</div>
                                  <div className="text-white/70 whitespace-pre-wrap">{s.body_b || '—'}</div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-white/70">{new Date(c.created_at).toLocaleString()}</div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ========== Create campaign form with step builder ========== */
function CreateCampaignForm({ onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState([
    {
      step_order: 1,
      delay_minutes: 0,
      subject: 'Congrats, {{first_name}} — fast wins at {{company}}',
      body: 'Hi {{first_name}},\n\nQuick playbook we use with {{company}} peers…\n\n— {{sender_name}}',
      subject_b: '',
      body_b: '',
      weight_b: 0,
      use_ai: false
    }
  ]);

  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [msg, setMsg] = useState('');

  function addStep() {
    setSteps(prev => {
      const nextOrder = (prev?.length || 0) + 1;
      return [
        ...prev,
        {
          step_order: nextOrder,
          delay_minutes: 1440,
          subject: `Follow-up ${nextOrder}`,
          body: 'Circling back…',
          subject_b: '',
          body_b: '',
          weight_b: 0,
          use_ai: false
        }
      ];
    });
  }

  function removeStep(idx) {
    setSteps(prev => {
      const arr = prev.filter((_, i) => i !== idx);
      // re-number orders
      return arr.map((s, i) => ({ ...s, step_order: i + 1 }));
    });
  }

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      if (!name.trim()) throw new Error('Name is required');
      if (!steps.length) throw new Error('Add at least one step');
      const payload = {
        name,
        description,
        steps: steps.map(s => ({
          step_order: Number(s.step_order || 1),
          delay_minutes: Number(s.delay_minutes || 0),
          subject: s.subject || '',
          body: s.body || '',
          subject_b: s.subject_b || null,
          body_b: s.body_b || null,
          weight_b: Number(s.weight_b || 0),
          use_ai: !!s.use_ai
        }))
      };
      const r = await fetch('/api/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Create failed');
      setMsg('Created!');
      onCreated?.();
      setName('');
      setDescription('');
      setSteps([]);
    } catch (e) {
      setMsg(String(e?.message || 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-black/50 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm font-medium">New campaign</div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="inline-flex items-center gap-2 rounded-md border border-white/15 px-2 py-1 text-xs hover:bg-white/10"
        >
          {expanded ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4" />}
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {expanded && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-white/60">Name</label>
              <input
                value={name}
                onChange={(e)=>setName(e.target.value)}
                placeholder="New CMO 2-Step"
                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">Description</label>
              <input
                value={description}
                onChange={(e)=>setDescription(e.target.value)}
                placeholder="Welcome + follow-up"
                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
              />
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div className="text-sm text-white/80">Steps</div>
            {steps.map((s, idx) => (
              <div key={idx} className="rounded-xl border border-white/10 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-xs text-white/60">Step {idx+1}</div>
                  <button
                    onClick={() => removeStep(idx)}
                    className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                    title="Remove step"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Delay (minutes)</label>
                    <input
                      type="number"
                      value={s.delay_minutes}
                      onChange={e => {
                        const v = parseInt(e.target.value || '0', 10);
                        setSteps(st => st.map((x,i)=> i===idx ? { ...x, delay_minutes: v } : x));
                      }}
                      className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs text-white/60">Subject (A)</label>
                    <input
                      value={s.subject}
                      onChange={e => setSteps(st => st.map((x,i)=> i===idx ? { ...x, subject: e.target.value } : x))}
                      placeholder="Congrats, {{first_name}} — fast wins at {{company}}"
                      className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-xs text-white/60">Body (A)</label>
                  <textarea
                    rows={4}
                    value={s.body}
                    onChange={e => setSteps(st => st.map((x,i)=> i===idx ? { ...x, body: e.target.value } : x))}
                    className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none"
                  />
                </div>

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-white/60 inline-flex items-center gap-2">
                    <Wand2 className="h-3.5 w-3.5" /> A/B variant (optional)
                  </summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs text-white/60">Weight for B (%)</label>
                      <input
                        type="number"
                        value={s.weight_b ?? 0}
                        min={0} max={100}
                        onChange={e => {
                          const v = Math.max(0, Math.min(100, parseInt(e.target.value || '0', 10)));
                          setSteps(st => st.map((x,i)=> i===idx ? { ...x, weight_b: v } : x));
                        }}
                        className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs text-white/60">Subject (B)</label>
                      <input
                        value={s.subject_b || ''}
                        onChange={e => setSteps(st => st.map((x,i)=> i===idx ? { ...x, subject_b: e.target.value } : x))}
                        placeholder="Welcome aboard, {{first_name}}"
                        className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="mb-1 block text-xs text-white/60">Body (B)</label>
                    <textarea
                      rows={4}
                      value={s.body_b || ''}
                      onChange={e => setSteps(st => st.map((x,i)=> i===idx ? { ...x, body_b: e.target.value } : x))}
                      className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none"
                    />
                  </div>
                </details>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={addStep}
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
            >
              <Plus className="h-4 w-4" /> Add step
            </button>

            <button
              onClick={save}
              disabled={saving || !name.trim() || steps.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Save campaign'}
            </button>

            {msg ? <span className="text-sm text-white/70">{msg}</span> : null}
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================
   Enroll: pick campaign + select contacts from /api/contacts/list
========================================================= */
function EnrollPanel() {
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [steps, setSteps] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [note, setNote] = useState('');

  // contacts
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 50;
  const [search, setSearch] = useState('');
  const [company, setCompany] = useState('');
  const [titleCSV, setTitleCSV] = useState('');
  const [selected, setSelected] = useState({}); // id -> true

  async function loadCampaigns() {
    try {
      const r = await fetch('/api/marketing/campaigns', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Failed to load campaigns');
      setCampaigns(j.campaigns || []);
      setSteps(j.steps || []);
      if (!campaignId && (j.campaigns || []).length) setCampaignId(j.campaigns[0].id);
    } catch (e) {
      setNote(String(e?.message || 'Load campaigns failed'));
    }
  }

  async function loadContacts({ keepPage = true } = {}) {
    setLoading(true);
    try {
      const p = keepPage ? page : 1;
      const u = new URL('/api/contacts/list', window.location.origin);
      if (search) u.searchParams.set('search', search);
      if (company) u.searchParams.set('company', company);
      if (titleCSV) u.searchParams.set('title', titleCSV);
      u.searchParams.set('page', String(p));
      u.searchParams.set('limit', String(limit));
      const r = await fetch(u.toString(), { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Failed to load contacts');
      setItems(j.items || []);
      setTotal(j.total || 0);
      if (!keepPage) setPage(1);
    } catch (e) {
      setNote(String(e?.message || 'Load contacts failed'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCampaigns(); }, []);
  useEffect(() => { loadContacts(); /* eslint-disable-next-line */ }, [page]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const selectedIds = useMemo(() => Object.keys(selected).filter(id => selected[id]), [selected]);
  const currentCampaign = useMemo(() => campaigns.find(c => c.id === campaignId) || null, [campaigns, campaignId]);
  const currentSteps = useMemo(() => (steps || []).filter(s => s.campaign_id === campaignId).sort((a,b)=>a.step_order-b.step_order), [steps, campaignId]);

  async function enroll() {
    setNote('');
    if (!campaignId) { setNote('Pick a campaign.'); return; }
    if (selectedIds.length === 0) { setNote('Select at least one contact.'); return; }
    try {
      const r = await fetch(`/api/marketing/campaigns/${campaignId}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: selectedIds })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Enroll failed');
      setNote(`Enrolled ${j.created} contact(s). Next run at: ${j.next_run_at}`);
      setSelected({});
    } catch (e) {
      setNote(String(e?.message || 'Enroll failed'));
    }
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-black/50 p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-white/60">Campaign</label>
            <select
              value={campaignId}
              onChange={(e)=>setCampaignId(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none"
            >
              {campaigns.length === 0 ? <option value="">—</option> : null}
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs text-white/60">Preview</label>
            <div className="rounded-lg border border-white/10 p-3 text-xs text-white/70">
              {currentCampaign ? (
                <>
                  <div className="text-white/80">{currentCampaign.name}</div>
                  <div className="text-white/60">{currentCampaign.description || '—'}</div>
                  <div className="mt-2">
                    {(currentSteps || []).map(s => (
                      <div key={s.id} className="mb-1">
                        <span className="text-white/60">Step {s.step_order} • {s.delay_minutes}m: </span>
                        <span className="text-white/80">{s.subject}</span>
                        {s.subject_b ? <span className="text-white/50"> (A/B)</span> : null}
                      </div>
                    ))}
                    {currentSteps.length === 0 ? <div className="text-white/50">No steps</div> : null}
                  </div>
                </>
              ) : 'Pick a campaign'}
            </div>
          </div>
        </div>

        {note ? <div className="mt-3 text-xs text-white/70">{note}</div> : null}
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-medium">Select contacts</div>
          <div className="text-xs text-white/60">{selectedIds.length} selected</div>
        </div>

        {/* Filters */}
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <input
            value={search}
            onChange={(e)=>setSearch(e.target.value)}
            placeholder="Search name/email/title/company…"
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
          />
          <input
            value={company}
            onChange={(e)=>setCompany(e.target.value)}
            placeholder="Company filter"
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
          />
          <input
            value={titleCSV}
            onChange={(e)=>setTitleCSV(e.target.value)}
            placeholder="Titles (CSV) e.g. CEO, CMO"
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setPage(1); loadContacts({ keepPage:false }); }}
              className="rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10"
            >
              Apply
            </button>
            <button
              onClick={() => { setSearch(''); setCompany(''); setTitleCSV(''); setPage(1); loadContacts({ keepPage:false }); }}
              className="rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full bg-black text-sm">
            <thead className="bg-white/5 text-white/70">
              <tr>
                <th className="px-4 py-3 text-left">Pick</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Company</th>
                <th className="px-4 py-3 text-left">Email</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-white/60">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-white/60">No contacts.</td></tr>
              ) : (
                items.map(c => {
                  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';
                  const comp = c.co_name || c.company || '—';
                  const checked = !!selected[c.id];
                  return (
                    <tr key={c.id} className="border-t border-white/10">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e)=> setSelected(s => ({ ...s, [c.id]: e.target.checked }))}
                        />
                      </td>
                      <td className="px-4 py-3">{name}</td>
                      <td className="px-4 py-3">{c.title || '—'}</td>
                      <td className="px-4 py-3">{comp}</td>
                      <td className="px-4 py-3">{c.email}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination + Enroll */}
        <div className="mt-3 flex items-center justify-between text-xs text-white/60">
          <div>Page {page} of {Math.max(1, Math.ceil(total / limit))}</div>
          <div className="flex gap-2">
            <button
              onClick={()=> setPage(p => Math.max(1, p-1))}
              disabled={page <= 1}
              className="rounded border border-white/20 px-2 py-1 disabled:opacity-50"
            >
              Prev
            </button>
            <button
              onClick={()=> setPage(p => Math.min(Math.max(1, Math.ceil(total / limit)), p+1))}
              disabled={page >= Math.max(1, Math.ceil(total / limit))}
              className="rounded border border-white/20 px-2 py-1 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={enroll}
            disabled={!campaignId || selectedIds.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
          >
            <MailPlus className="h-4 w-4" />
            Enroll {selectedIds.length} contact(s)
          </button>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   Scheduler panel: run tick & show stats
========================================================= */
function SchedulerPanel() {
  const [running, setRunning] = useState(false);
  const [batch, setBatch] = useState(50);
  const [res, setRes] = useState(null);
  const [msg, setMsg] = useState('');

  async function runTick() {
    setRunning(true);
    setRes(null);
    setMsg('');
    try {
      const u = new URL('/api/marketing/cron/tick', window.location.origin);
      u.searchParams.set('batch', String(Math.max(1, Math.min(200, batch))));
      const r = await fetch(u.toString(), { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Tick failed');
      setRes(j);
    } catch (e) {
      setMsg(String(e?.message || 'Tick failed'));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-black/50 p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-white/60">Batch size</label>
            <input
              type="number"
              value={batch}
              onChange={(e)=> setBatch(parseInt(e.target.value || '50', 10))}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none"
            />
          </div>
          <div className="md:col-span-2 flex items-end">
            <button
              onClick={runTick}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {running ? 'Running…' : 'Run scheduler tick'}
            </button>
          </div>
        </div>
        {msg ? <div className="mt-2 text-xs text-white/70">{msg}</div> : null}
      </div>

      {res && (
        <div className="rounded-2xl border border-white/10 bg-black/50 p-5">
          <div className="mb-2 text-sm font-medium">Last tick result</div>
          <ul className="grid gap-2 text-sm text-white/80 md:grid-cols-3">
            <li className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-400" /> Processed: {res.processed}</li>
            <li className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-400" /> Sent: {res.sent}</li>
            <li className="inline-flex items-center gap-2"><XCircle className="h-4 w-4 text-yellow-400" /> Queued: {res.queued}</li>
            <li className="inline-flex items-center gap-2">Suppressed: {res.suppressed}</li>
            <li className="inline-flex items-center gap-2">Completed: {res.completed}</li>
            <li className="inline-flex items-center gap-2">Skipped (quiet hrs): {res.skipped_quiet}</li>
          </ul>

          <div className="mt-4 rounded-lg border border-white/10 bg-black/60 p-4">
            <div className="text-xs text-white/60 mb-2">Raw</div>
            <pre className="max-h-[300px] overflow-auto text-xs text-white/80">
{JSON.stringify(res, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
