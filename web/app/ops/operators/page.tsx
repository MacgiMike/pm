'use client';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { Avatar, Confirm, Loading, useAction } from '@/components/ui';

export default function OpsOperatorsPage() {
  const o = useApi<any[]>('/ops/operators');
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: '', email: '' });
  const [removing, setRemoving] = useState<any>(null);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post('/ops/operators', f), 'Operator added');
    if (r) { setF({ name: '', email: '' }); o.reload(); }
  };
  return (
    <section className="card">
      <div className="card-head"><h2>Operators</h2><span className="small muted">People at Lockred who can use this console. 2-step sign-in is required.</span></div>
      {!o.data ? <Loading /> : o.data.map((x) => (
        <div key={x.id} className="trow" style={{ gridTemplateColumns: 'minmax(0,1.5fr) 110px 150px 100px' }}>
          <span className="row gap8"><Avatar name={x.name} /><span className="col" style={{ gap: 1 }}><span className="strong">{x.name}</span><span className="tiny muted">{x.email}</span></span></span>
          <span className={`small strong ${x.mfa ? 'txt-ok' : 'txt-bad'}`}>{x.mfa ? '2-step on' : 'No 2-step'}</span>
          <span className="small muted">{x.lastLoginAt ? `Signed in ${timeAgo(x.lastLoginAt)}` : 'Never signed in'}</span>
          <button className="btn sm danger" onClick={() => setRemoving(x)}>Remove</button>
        </div>
      ))}
      <form onSubmit={add} className="row wrap gap8" style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
        <input className="input sm" style={{ width: 200 }} placeholder="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" />
        <input className="input sm grow" type="email" placeholder="Email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-label="Email" />
        <button className="btn sm primary" disabled={busy}>Add operator</button>
      </form>
      {removing && <Confirm title={`Remove ${removing.name}?`} text="They lose access to the operator console and are signed out." confirmLabel="Remove" danger
        onConfirm={() => run(() => api.del(`/ops/operators/${removing.id}`), 'Operator removed').then(o.reload)} onClose={() => setRemoving(null)} />}
    </section>
  );
}
