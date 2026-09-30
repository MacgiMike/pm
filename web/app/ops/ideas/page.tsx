'use client';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { Loading, useAction } from '@/components/ui';

const STATUSES = [['UNDER_REVIEW', 'Under review'], ['PLANNED', 'Planned'], ['SHIPPED', 'Shipped'], ['DECLINED', 'Declined']] as const;

export default function OpsIdeasPage() {
  const ideas = useApi<any[]>('/ops/ideas');
  const { busy, run } = useAction();
  const [title, setTitle] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post('/ops/ideas', { title }), 'Idea added');
    if (r) { setTitle(''); ideas.reload(); }
  };
  return (
    <section className="card">
      <div className="card-head"><h2>Idea board</h2><span className="small muted">Shown to every customer under Help &amp; support (except declined)</span></div>
      <form onSubmit={add} className="row gap8" style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
        <input className="input sm grow" placeholder="New idea, e.g. Import tasks from Excel" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} aria-label="New idea" />
        <button className="btn sm primary" disabled={busy}>Add</button>
      </form>
      {!ideas.data ? <Loading /> : ideas.data.length === 0 ? <div className="empty">No ideas yet.</div> : ideas.data.slice().sort((a, b) => b.votes - a.votes).map((i) => (
        <div key={i.id} className="trow" style={{ gridTemplateColumns: '60px minmax(0,1fr) 110px 170px' }}>
          <span className="mono strong">{i.votes}</span>
          <span className="col" style={{ gap: 2 }}><span className="strong">{i.title}</span>{i.description && <span className="tiny muted ellipsis">{i.description}</span>}</span>
          <span className="tiny muted">{shortDate(i.createdAt)}</span>
          <select className="select sm" value={i.status} aria-label={`Status for ${i.title}`} onChange={(e) => run(() => api.patch(`/ops/ideas/${i.id}`, { status: e.target.value })).then(ideas.reload)}>
            {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      ))}
    </section>
  );
}
