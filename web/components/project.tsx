'use client';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { money, ROLE_LABEL } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { I } from './icons';
import { Avatar, Confirm, InlineText, Loading, MoneyInput, useAction } from './ui';

export function TagEditor({ tags, onChange, disabled, tone, label }: {
  tags: string[]; onChange: (t: string[]) => Promise<unknown>; disabled?: boolean; tone?: 'green'; label: string;
}) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const t = v.trim();
    if (!t) return setAdding(false);
    await onChange([...tags, t]);
    setV('');
    setAdding(false);
  };
  return (
    <div className="row wrap gap6" aria-label={label}>
      {tags.map((t, i) => (
        <span key={`${t}-${i}`} className={`tag ${tone ?? ''}`}>
          {t}
          {!disabled && <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(tags.filter((_, j) => j !== i))}>×</button>}
        </span>
      ))}
      {!disabled && (adding ? (
        <form onSubmit={add} className="row gap6">
          <input className="input sm" autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={add} style={{ width: 180 }} aria-label={`New ${label} item`} />
        </form>
      ) : (
        <button type="button" className="chip dashed" onClick={() => setAdding(true)}>+ Add</button>
      ))}
    </div>
  );
}

/** Budget posts list with inline editing — used in setup and on the budget page. */
export function PostsEditor({ projectId, posts, currency, canEdit, onChanged, compact }: {
  projectId: string; posts: { id: string; name: string; amount: number; spent?: number }[]; currency: string; canEdit: boolean; onChanged: () => void; compact?: boolean;
}) {
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post(`/projects/${projectId}/budget/posts`, { name, amount: Number(amount.replace(/\s/g, '').replace(',', '.')) || 0 }));
    if (r) { setName(''); setAmount(''); onChanged(); }
  };
  return (
    <div className="col gap8">
      {posts.map((p) => (
        <div key={p.id} className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) 180px 40px', gap: 10, alignItems: 'center' }}>
          <InlineText ariaLabel="Post name" value={p.name} disabled={!canEdit} className="sm" onSave={(v) => api.patch(`/projects/${projectId}/budget/posts/${p.id}`, { name: v }).then(onChanged)} />
          <MoneyInput ariaLabel={`Amount for ${p.name}`} value={p.amount} currency={currency} disabled={!canEdit} className="sm"
            onSave={(v) => api.patch(`/projects/${projectId}/budget/posts/${p.id}`, { amount: v }).then(onChanged)} />
          {canEdit ? <button className="icon-btn" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p.id)}><I.Trash /></button> : <span />}
        </div>
      ))}
      {canEdit && (
        <form onSubmit={add} className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) 180px auto', gap: 10 }}>
          <input className="input sm" placeholder={compact ? 'New post, e.g. Consultants' : 'New budget post, e.g. External consultants'} value={name} onChange={(e) => setName(e.target.value)} required aria-label="New budget post name" />
          <input className="input sm money" placeholder={`Amount (${currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required aria-label="Amount" />
          <button className="btn sm" disabled={busy}>Add</button>
        </form>
      )}
      {deleting && (
        <Confirm title="Delete this budget post?" text="You can only delete posts without booked costs." confirmLabel="Delete" danger
          onConfirm={() => run(() => api.del(`/projects/${projectId}/budget/posts/${deleting}`), 'Budget post deleted').then(onChanged)} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

export function sumPosts(posts: { amount: number }[]) {
  return posts.reduce((s, p) => s + p.amount, 0);
}

export function AllocationNote({ approved, allocated, currency }: { approved: number; allocated: number; currency: string }) {
  if (!approved) return <div className="note">Set the approved budget above, or just add posts — their total counts as the budget.</div>;
  const diff = approved - allocated;
  if (Math.abs(diff) < 1) return <div className="note ok row between"><span>All of the budget is split into posts</span><span className="mono">{money(allocated, currency)} / {money(approved, currency)}</span></div>;
  if (diff > 0) return <div className="note warn row between"><span>{money(diff, currency)} not yet split into posts</span><span className="mono">{money(allocated, currency)} / {money(approved, currency)}</span></div>;
  return <div className="note bad row between"><span>Posts add up to {money(-diff, currency)} more than approved</span><span className="mono">{money(allocated, currency)} / {money(approved, currency)}</span></div>;
}

/** Add people to a project (owner only). */
export function TeamAdd({ projectId, onChanged, showList = true }: { projectId: string; onChanged: () => void; showList?: boolean }) {
  const m = useApi<any>(`/projects/${projectId}/members`);
  const { busy, run } = useAction();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<string>('');
  const [role, setRole] = useState<'CONTRIBUTOR' | 'COLEAD'>('CONTRIBUTOR');
  if (!m.data) return <Loading />;
  const candidates = (m.data.candidates as { accountId: string; name: string; email: string }[]).filter(
    (c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.email.toLowerCase().includes(q.toLowerCase()),
  );
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const target = pick || (candidates.length === 1 ? candidates[0].accountId : '');
    if (!target) {
      await run(() => Promise.reject(new Error(candidates.length ? 'Pick one person from the list' : 'No one matches that name')));
      return;
    }
    const r = await run(() => api.post(`/projects/${projectId}/members`, { accountId: target, role }), 'Added — they’ve been emailed a link');
    if (r) { setQ(''); setPick(''); m.reload(); onChanged(); }
  };
  return (
    <div className="col gap14">
      <form onSubmit={add} className="row wrap gap8" style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <input className="input" list={`cand-${projectId}`} placeholder="Add people by name or email" value={q}
            onChange={(e) => {
              setQ(e.target.value);
              const hit = (m.data.candidates as any[]).find((c) => c.name === e.target.value || c.email === e.target.value);
              setPick(hit?.accountId ?? '');
            }} aria-label="Person to add" />
          <datalist id={`cand-${projectId}`}>
            {(m.data.candidates as any[]).map((c) => <option key={c.accountId} value={c.name}>{c.email}</option>)}
          </datalist>
        </div>
        <select className="select" style={{ width: 160 }} value={role} onChange={(e) => setRole(e.target.value as any)} aria-label="Role">
          <option value="CONTRIBUTOR">Contributor</option>
          <option value="COLEAD">Co-lead</option>
        </select>
        <button className="btn primary" disabled={busy || candidates.length === 0}>Add</button>
      </form>
      {m.data.candidates.length === 0 && <p className="small muted">Everyone in the organization is already on the project. Invite more people under Admin → Users.</p>}
      {showList && <div className="card">
        {(m.data.members as any[]).map((x) => (
          <div key={x.id} className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', gap: 10 }}>
            <Avatar name={x.name} small /><span className="grow">{x.name}</span><span className="small muted">{ROLE_LABEL[x.role]}</span>
          </div>
        ))}
      </div>}
    </div>
  );
}
