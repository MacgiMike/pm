'use client';
import Link from 'next/link';
import { useState } from 'react';
import { timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { SEVERITY_LABEL, TICKET_STATUS, TYPE_LABEL } from '@/components/ops';
import { Loading } from '@/components/ui';

export default function OpsSupportPage() {
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const t = useApi<any[]>(`/ops/tickets?status=${status}`);
  const now = Date.now();
  return (
    <section className="card">
      <div className="card-head">
        <h2>Support queue</h2>
        <div className="seg" role="group" aria-label="Filter">
          {(['open', 'closed', 'all'] as const).map((s) => <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}
        </div>
      </div>
      {!t.data ? <Loading /> : t.data.length === 0 ? <div className="empty">Nothing here.</div> : (
        <div className="scroll-x"><div className="table" style={{ minWidth: 860 }}>
          <div className="trow thead" style={{ gridTemplateColumns: COLS }}><span>Request</span><span>Tenant</span><span>Type</span><span>Reply due</span><span>Status</span></div>
          {t.data.map((k) => {
            const [label, cls] = TICKET_STATUS[k.status] ?? [k.status, 'neutral'];
            const due = k.replyDueAt ? new Date(k.replyDueAt).getTime() : null;
            const left = due ? Math.round((due - now) / 60000) : null;
            return (
              <Link key={k.id} href={`/ops/support/${k.id}`} className="trow" style={{ gridTemplateColumns: COLS }}>
                <span className="col" style={{ gap: 2, minWidth: 0 }}><span className="strong ellipsis"><span className="mono tiny muted">{k.ref}</span> {k.subject}</span><span className="tiny muted">{k.createdByName} · {timeAgo(k.createdAt)}</span></span>
                <span className="small ellipsis">{k.tenant.name}</span>
                <span className="small">{TYPE_LABEL[k.type]}{k.severity ? ` · ${SEVERITY_LABEL[k.severity] ?? k.severity}` : ''}</span>
                <span className={`small strong ${left !== null && left < 0 ? 'txt-bad' : left !== null && left < 120 ? 'txt-warn' : 'muted'}`}>
                  {left === null ? (k.waitingOnUs ? '' : 'Waiting on customer') : left < 0 ? `${Math.round(-left / 60)} h overdue` : left < 120 ? `${left} min left` : `${Math.round(left / 60)} h left`}
                </span>
                <span><span className={`badge ${cls}`}>{label}</span></span>
              </Link>
            );
          })}
        </div></div>
      )}
      <p className="tiny muted" style={{ padding: '10px 20px' }}>Reply targets: 4 hours when a customer can’t work, otherwise 1 working day.</p>
    </section>
  );
}

const COLS = 'minmax(0,2.2fr) minmax(0,1.1fr) minmax(0,1fr) 140px 170px';
