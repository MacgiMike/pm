'use client';
import { useParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { useTenant } from '@/lib/context';
import { timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { Topbar } from '@/components/shell';
import { ErrorBox, Loading, useAction } from '@/components/ui';

const STATUS: Record<string, [string, string]> = {
  OPEN: ['Open', 'info'], WAITING_ON_CUSTOMER: ['Waiting on you', 'warn'], PLANNED: ['Planned', 'info'], RESOLVED: ['Resolved', 'ok'], CLOSED: ['Closed', 'neutral'],
};

export default function TicketPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const { me, base } = useTenant();
  const t = useApi<any>(`/support/tickets/${ticketId}`);
  const [reply, setReply] = useState('');
  const { busy, run } = useAction();
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post(`/support/tickets/${ticketId}/messages`, { body: reply }), 'Reply sent');
    if (r) { setReply(''); t.reload(); }
  };
  return (
    <>
      <Topbar crumbs={[{ label: me.tenant!.name, href: base }, { label: 'Help & support', href: `${base}/support` }, { label: t.data?.ref ?? 'Request' }]} />
      <div className="page" style={{ maxWidth: 860 }}>
        {t.error && <ErrorBox error={t.error} />}
        {!t.data && !t.error && <Loading />}
        {t.data && (
          <>
            <div className="row wrap gap8">
              <h1 className="page-title grow" style={{ fontSize: 24 }}>{t.data.subject}</h1>
              <span className={`badge ${(STATUS[t.data.status] ?? ['', 'neutral'])[1]}`}>{(STATUS[t.data.status] ?? [t.data.status])[0]}</span>
            </div>
            <p className="small muted">{t.data.ref} · {t.data.createdByName} · {timeAgo(t.data.createdAt)}</p>
            <div className="card pad" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{t.data.body}</div>
            {t.data.messages.map((m: any) => (
              <div key={m.id} className="card pad col gap6" style={m.fromOperator ? { borderColor: '#C9D5F2', background: '#F7F9FE' } : undefined}>
                <span className="small"><strong>{m.authorName}</strong> <span className="muted">· {timeAgo(m.createdAt)}</span></span>
                <span style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{m.body}</span>
              </div>
            ))}
            {t.data.status !== 'CLOSED' && (
              <form className="card pad col gap8" onSubmit={send}>
                <label className="field">Reply<textarea className="textarea" rows={4} required value={reply} onChange={(e) => setReply(e.target.value)} /></label>
                <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy}>Send reply</button></div>
              </form>
            )}
          </>
        )}
      </div>
    </>
  );
}
