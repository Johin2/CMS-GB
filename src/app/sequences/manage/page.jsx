'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Loader2,
  Plus,
  Save,
  Trash2,
  ChevronDown,
  ChevronRight,
  RefreshCcw,
  Pencil,
  Check,
  X,
  ArrowUp,
  ArrowDown,
  Clipboard,
} from 'lucide-react';

export default function SequencesManagerPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]); // [{ id, name, description, steps: [...] }]
  const [note, setNote] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [open, setOpen] = useState({}); // { [seqId]: boolean }
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setNote('');
    try {
      const res = await fetch('/api/sequences?withSteps=1', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load sequences');
      setItems(Array.isArray(data?.sequences) ? data.sequences : []);
    } catch (e) {
      setNote(e?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createSequence() {
    if (!newName.trim()) return;
    setBusy(true);
    setNote('');
    try {
      const res = await fetch('/api/sequences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), description: newDesc || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Create failed');
      setNewName('');
      setNewDesc('');
      setNote('Sequence created.');
      await load();
      // auto-open the newly created sequence
      if (data?.sequence?.id) {
        setOpen((p) => ({ ...p, [data.sequence.id]: true }));
      }
    } catch (e) {
      setNote(e?.message || 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSequence(id) {
    if (!id) return;
    if (!confirm('Delete sequence and all its steps?')) return;
    setBusy(true);
    setNote('');
    try {
      const res = await fetch(`/api/sequences/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Delete failed');
      setNote('Deleted.');
      await load();
    } catch (e) {
      setNote(e?.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  function toggleOpen(id) {
    setOpen((p) => ({ ...p, [id]: !p[id] }));
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sequences Manager</h1>
            {note ? <p className="mt-2 text-xs text-white/60">{note}</p> : null}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            title="Refresh"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </header>

        {/* Create sequence */}
        <section className="rounded-xl border border-white/10 p-4">
          <div className="text-sm font-medium mb-3">Create new sequence</div>
          <div className="grid gap-3 md:grid-cols-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Sequence name (e.g. Warm CEOs)"
              className="rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40"
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none placeholder:text-white/40 md:col-span-2"
            />
          </div>
          <div className="mt-3">
            <button
              onClick={createSequence}
              disabled={busy || !newName.trim()}
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create
            </button>
          </div>
        </section>

        {/* List sequences */}
        <section className="rounded-xl border border-white/10 p-4">
          <div className="text-sm font-medium mb-3">Your sequences</div>
          {loading ? (
            <div className="flex items-center gap-2 text-white/70">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="text-white/60 text-sm">No sequences yet.</div>
          ) : (
            <div className="space-y-3">
              {items.map((seq) => (
                <SequenceRow
                  key={seq.id}
                  seq={seq}
                  open={!!open[seq.id]}
                  onToggle={() => toggleOpen(seq.id)}
                  onDeleted={() => deleteSequence(seq.id)}
                  onChanged={load}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/* ---------------- Row (rename / delete / expand) ---------------- */
function SequenceRow({ seq, open, onToggle, onDeleted, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(seq.name || '');
  const [desc, setDesc] = useState(seq.description || '');
  const [saving, setSaving] = useState(false);

  async function saveMeta() {
    setSaving(true);
    try {
      const res = await fetch(`/api/sequences/${seq.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: desc }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Update failed');
      setEditing(false);
      onChanged?.();
    } catch (e) {
      alert(e?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/10">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onToggle} className="inline-flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <div className="text-sm text-left">
            {!editing ? (
              <>
                <div className="font-medium">{seq.name}</div>
                <div className="text-white/60">{seq.description || 'No description'}</div>
              </>
            ) : (
              <div className="grid gap-2 md:grid-cols-6">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded border border-white/10 bg-black px-2 py-1 text-sm md:col-span-2"
                />
                <input
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  className="rounded border border-white/10 bg-black px-2 py-1 text-sm md:col-span-4"
                />
              </div>
            )}
          </div>
        </button>
        <div className="flex items-center gap-2">
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 rounded-md border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
            >
              <Pencil className="h-3.5 w-3.5" /> Rename
            </button>
          ) : (
            <>
              <button
                onClick={saveMeta}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md border border-white/20 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
              </button>
              <button
                onClick={() => { setEditing(false); setName(seq.name || ''); setDesc(seq.description || ''); }}
                className="inline-flex items-center gap-2 rounded-md border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            </>
          )}
          <button
            onClick={onDeleted}
            className="inline-flex items-center gap-2 rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>

      {open ? <StepsEditor sequenceId={seq.id} initialSteps={seq.steps || []} onChanged={onChanged} /> : null}
    </div>
  );
}

/* ---------------- Steps editor (add/edit/delete/reorder) ---------------- */
function StepsEditor({ sequenceId, initialSteps, onChanged }) {
  const [steps, setSteps] = useState(initialSteps || []);
  const sorted = useMemo(
    () => [...steps].sort((a, b) => a.step_order - b.step_order),
    [steps]
  );

  const [savingId, setSavingId] = useState(null);
  const [newOrder, setNewOrder] = useState(sorted.length ? Math.max(...sorted.map(s => s.step_order)) + 1 : 1);
  const [newSubject, setNewSubject] = useState('');
  const [newBody, setNewBody] = useState('');

  useEffect(() => {
    setSteps(initialSteps || []);
    setNewOrder((initialSteps && initialSteps.length ? Math.max(...initialSteps.map(s => s.step_order)) + 1 : 1));
  }, [initialSteps]);

  async function addStep() {
    if (!newSubject.trim() || !String(newOrder)) return;
    const res = await fetch(`/api/sequences/${sequenceId}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step_order: Number(newOrder), subject: newSubject, body: newBody }),
    });
    const data = await res.json();
    if (!res.ok) return alert(data?.error || 'Create step failed');
    setSteps((prev) => [...prev, data.step].sort((a, b) => a.step_order - b.step_order));
    setNewSubject('');
    setNewBody('');
    setNewOrder((o) => o + 1);
    onChanged?.();
  }

  async function saveStep(s) {
    setSavingId(s.id);
    const res = await fetch(`/api/sequence-steps/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: s.subject, body: s.body, step_order: s.step_order }),
    });
    const data = await res.json();
    setSavingId(null);
    if (!res.ok) return alert(data?.error || 'Update failed');
    onChanged?.();
  }

  async function deleteStep(id) {
    if (!confirm('Delete this step?')) return;
    const res = await fetch(`/api/sequence-steps/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return alert(data?.error || 'Delete failed');
    setSteps((prev) => prev.filter((s) => s.id !== id));
    onChanged?.();
  }

  async function move(stepId, dir) {
    // dir: -1 (up) or +1 (down)
    const idx = sorted.findIndex((s) => s.id === stepId);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const a = sorted[idx];
    const b = sorted[swapIdx];

    // swap orders locally
    const next = steps.map((s) => {
      if (s.id === a.id) return { ...s, step_order: b.step_order };
      if (s.id === b.id) return { ...s, step_order: a.step_order };
      return s;
    });
    setSteps(next);

    // persist both updates
    try {
      await Promise.all([
        fetch(`/api/sequence-steps/${a.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step_order: b.step_order }),
        }),
        fetch(`/api/sequence-steps/${b.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step_order: a.step_order }),
        }),
      ]);
      onChanged?.();
    } catch {
      // soft-fail; you could reload to fix bad state
    }
  }

  function copyTokens() {
    const txt = `Available tokens (examples):
{{first_name}} {{last_name}} {{company}} {{month}} {{category}} {{sender_name}}
With transforms: {{first_name|there|title}} {{company|ACME|upper}}
`;
    navigator.clipboard?.writeText(txt).catch(() => {});
  }

  return (
    <div className="border-top border-white/10 px-4 py-3 space-y-4">
      {sorted.length === 0 ? (
        <div className="text-xs text-white/60">No steps yet.</div>
      ) : (
        sorted.map((s, i) => (
          <div key={s.id} className="rounded-md border border-white/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs text-white/60">Step #{s.step_order}</div>
              <div className="flex gap-1">
                <button
                  onClick={() => move(s.id, -1)}
                  disabled={i === 0}
                  title="Move up"
                  className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => move(s.id, +1)}
                  disabled={i === sorted.length - 1}
                  title="Move down"
                  className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-6 items-center">
              <label className="text-xs text-white/60">Step order</label>
              <input
                type="number"
                value={s.step_order}
                onChange={(e) =>
                  setSteps((prev) =>
                    prev.map((x) => (x.id === s.id ? { ...x, step_order: Number(e.target.value) } : x))
                  )
                }
                className="rounded border border-white/10 bg-black px-2 py-1 text-sm md:col-span-1"
              />
              <label className="text-xs text-white/60 md:pl-2">Subject</label>
              <input
                value={s.subject || ''}
                onChange={(e) =>
                  setSteps((prev) => prev.map((x) => (x.id === s.id ? { ...x, subject: e.target.value } : x)))
                }
                className="rounded border border-white/10 bg-black px-2 py-1 text-sm md:col-span-3"
              />
            </div>

            <textarea
              value={s.body || ''}
              onChange={(e) => setSteps((prev) => prev.map((x) => (x.id === s.id ? { ...x, body: e.target.value } : x)))}
              rows={5}
              className="w-full rounded border border-white/10 bg-black px-2 py-1 text-sm"
              placeholder="Body (supports tokens like {{first_name}}, {{company}}, transforms like {{first_name|there|title}})"
            />

            <div className="flex gap-2">
              <button
                onClick={() => saveStep(s)}
                className="inline-flex items-center gap-2 rounded-md border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
              >
                {savingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </button>
              <button
                onClick={() => deleteStep(s.id)}
                className="inline-flex items-center gap-2 rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
              <button
                onClick={copyTokens}
                className="inline-flex items-center gap-2 rounded-md border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
                title="Copy token cheatsheet"
              >
                <Clipboard className="h-3.5 w-3.5" /> Tokens
              </button>
            </div>
          </div>
        ))
      )}

      {/* Add new step */}
      <div className="rounded-md border border-white/10 p-3">
        <div className="text-xs font-medium mb-2">Add step</div>
        <div className="grid gap-2 md:grid-cols-6 items-center">
          <label className="text-xs text-white/60">Step order</label>
          <input
            type="number"
            value={newOrder}
            onChange={(e) => setNewOrder(Number(e.target.value))}
            className="rounded border border-white/10 bg-black px-2 py-1 text-sm md:col-span-1"
          />
          <label className="text-xs text-white/60 md:pl-2">Subject</label>
          <input
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            className="rounded border border-white/10 bg-black px-2 py-1 text-sm md:col-span-3"
            placeholder="Subject"
          />
        </div>
        <textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          rows={5}
          className="mt-2 w-full rounded border border-white/10 bg-black px-2 py-1 text-sm"
          placeholder="Body (supports tokens like {{first_name}}, {{company}})"
        />
        <div className="mt-2">
          <button
            onClick={addStep}
            className="inline-flex items-center gap-2 rounded-md border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
          >
            <Plus className="h-3.5 w-3.5" /> Add step
          </button>
        </div>
      </div>
    </div>
  );
}
