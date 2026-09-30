'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { SEVERITY_LABEL, TICKET_STATUS, TYPE_LABEL } from '@/components/ops';
import { ErrorBox, Loading, useAction } from '@/components/ui';

export default function OpsTicketPage() {
  const { id } = useParams<{ id: string }>();
  const t = useApi<any>(`/ops/tickets/${id}`);
  const [body, setBody] = useState('');
  const [after, setAfter] = useState('WAITING_ON_CUSTOMER');
  const { busy, run } = useAction();
  if (t.error) return <ErrorBox error={t.error} />;
  if (!t.data) return <Loading />;
  const d = t.data;
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post(`/ops/tickets/${id}/messages`, { body, status: after }), 'Reply sent to the customer');
    if (r) { setBody(''); t.reload(); }
  };
  return (
    <>
      <Link href="/ops/support" className="small muted">← Support queue</Link>
      <div className="grid split" style={{ alignItems: 'start' }}>
        <div className="col gap14">
          <div className="row wrap gap8"><h1 className="page-title grow" style={{ fontSize: 24 }}>{d.subject}</h1><span className={`badge ${(TICKET_STATUS[d.status] ?? ['', 'neutral'])[1]}`}>{(TICKET_STATUS[d.status] ?? [d.status])[0]}</span></div>
          <p className="small muted">{d.ref} · {TYPE_LABEL[d.type]}{d.severity ? ` · ${SEVERITY_LABEL[d.severity] ?? d.severity}` : ''} · {d.createdByName}{d.createdByEmail ? ` <${d.createdByEmail}>` : ''} · {timeAgo(d.createdAt)}</p>
          <div className="card pad" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{d.body}</div>
          {d.messages.map((m: any) => (
            <div key={m.id} className="card pad col gap6" style={m.fromOperator ? { borderColor: '#C9D5F2', background: '#F7F9FE' } : undefined}>
              <span className="small"><strong>{m.authorName}</strong> <span className="muted">· {timeAgo(m.createdAt)}</span></span>
              <span style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{m.body}</span>
            </div>
          ))}
          <form className="card pad col gap8" onSubmit={send}>
            <label className="field">Reply to the customer<textarea className="textarea" rows={5} required value={body} onChange={(e) => setBody(e.target.value)} /></label>
            <div className="row wrap gap8">
              <span className="small muted">After sending, set status to</span>
              <select className="select sm" style={{ width: 200 }} value={after} onChange={(e) => setAfter(e.target.value)} aria-label="Status after reply">
                {Object.entries(TICKET_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <span className="grow" />
              <button className="btn primary" disabled={busy}>Send reply</button>
            </div>
          </form>
        </div>
        <aside className="col gap14">
          <section className="card pad col gap8">
            <span className="section-title">Tenant</span>
            <Link href={`/ops/tenants/${d.tenant.id}`} className="strong">{d.tenant.name}</Link>
            <span className="small muted">/{d.tenant.slug} · {d.tenant.plan}</span>
          </section>
          <section className="card pad col gap8">
            <span className="section-title">Status</span>
            <div className="chips">
              {Object.entries(TICKET_STATUS).map(([k, [l]]) => (
                <button key={k} className="chip" aria-pressed={d.status === k} onClick={() => run(() => api.patch(`/ops/tickets/${id}`, { status: k })).then(t.reload)}>{l}</button>
              ))}
            </div>
            {d.type === 'FEATURE' && <button className="btn sm" onClick={() => run(() => api.post(`/ops/tickets/${id}/idea`), 'Added to the public idea board').then(t.reload)}>Add to idea board</button>}
          </section>
          {d.diagnostics && (
            <section className="card pad col gap6">
              <span className="section-title">Technical details</span>
              <pre className="mono tiny" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text2)' }}>{JSON.stringify(d.diagnostics, null, 2)}</pre>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
