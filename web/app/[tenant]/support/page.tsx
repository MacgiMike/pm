'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { useTenant } from '@/lib/context';
import { timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { I } from '@/components/icons';
import { Topbar } from '@/components/shell';
import { Loading, useAction } from '@/components/ui';

const TYPES = [
  { id: 'PROBLEM', label: 'Something’s broken', sub: 'Errors, bugs, outages', desc: 'What happened, and what did you expect?' },
  { id: 'QUESTION', label: 'Question', sub: 'How do I…?', desc: 'Your question' },
  { id: 'FEATURE', label: 'Feature idea', sub: 'Something you’d like', desc: 'What would you like, and what would it help you do?' },
  { id: 'BILLING', label: 'Billing', sub: 'Plans, invoices, seats', desc: 'How can we help?' },
];
const TICKET_STATUS: Record<string, [string, string]> = {
  OPEN: ['Open', 'info'], WAITING_ON_CUSTOMER: ['Waiting on you', 'warn'], PLANNED: ['Planned', 'info'], RESOLVED: ['Resolved', 'ok'], CLOSED: ['Closed', 'neutral'],
};

export default function SupportPage() {
  const { me, base } = useTenant();
  const tickets = useApi<any[]>('/support/tickets');
  const ideas = useApi<any[]>('/support/ideas');
  const [type, setType] = useState('PROBLEM');
  const [severity, setSeverity] = useState('SLOWS_DOWN');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [diag, setDiag] = useState(true);
  const [sent, setSent] = useState<string | null>(null);
  const { busy, run } = useAction();
  const t = TYPES.find((x) => x.id === type)!;
  const isDemo = me.tenant!.isDemo;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const diagnostics = type === 'PROBLEM' && diag ? { page: document.referrer || null, userAgent: navigator.userAgent, screen: `${window.innerWidth}x${window.innerHeight}`, time: new Date().toISOString() } : undefined;
    const r = await run(() => api.post('/support/tickets', { type, severity: type === 'PROBLEM' ? severity : '', subject, body, diagnostics }));
    if (r) { setSent(r.ref); setSubject(''); setBody(''); tickets.reload(); }
  };

  return (
    <>
      <Topbar crumbs={[{ label: me.tenant!.name, href: base }, { label: 'Help & support' }]} />
      <div className="page">
        <div className="grid split" style={{ alignItems: 'start' }}>
          <section className="card pad col gap16" style={{ padding: '22px 24px' }}>
            <div className="col gap4"><h1 className="page-title" style={{ fontSize: 26 }}>Contact Lockred</h1><p className="small muted">A real person answers, usually within one working day.</p></div>
            {isDemo && <div className="note">This is a demo, so requests can’t be sent from here. Start a free trial to reach support.</div>}
            {sent && <div className="note ok" role="status">Thanks — we got your request <strong>{sent}</strong>. We’ve emailed you a confirmation.</div>}
            <form className="col gap16" onSubmit={submit}>
              <fieldset className="col gap8" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="small strong" style={{ marginBottom: 8 }}>What’s this about?</legend>
                <div className="grid g4" style={{ gap: 8 }}>
                  {TYPES.map((x) => (
                    <button key={x.id} type="button" aria-pressed={type === x.id} onClick={() => setType(x.id)} className="col" style={{ gap: 2, padding: 12, borderRadius: 10, textAlign: 'left', cursor: 'pointer', background: type === x.id ? 'var(--bg)' : 'var(--surface)', border: type === x.id ? '1.5px solid var(--ink)' : '1px solid var(--border)' }}>
                      <span className="small strong">{x.label}</span><span className="tiny muted">{x.sub}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="field">Subject<input className="input" required minLength={3} value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
              <label className="field">{t.desc}<textarea className="textarea" rows={5} required minLength={3} value={body} onChange={(e) => setBody(e.target.value)} /></label>
              {type === 'PROBLEM' && (
                <div className="col gap8">
                  <span className="small strong">How much is it blocking you?</span>
                  <div className="chips">
                    {[['BLOCKING', 'Can’t work'], ['SLOWS_DOWN', 'Slows me down'], ['MINOR', 'Minor']].map(([k, l]) => (
                      <button key={k} type="button" className="chip" aria-pressed={severity === k} onClick={() => setSeverity(k)}>{l}</button>
                    ))}
                  </div>
                  <label className="check"><input type="checkbox" checked={diag} onChange={(e) => setDiag(e.target.checked)} />Include technical details (browser, screen size, time) — no project data</label>
                </div>
              )}
              <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary lg" disabled={busy || isDemo}>Send</button></div>
            </form>
          </section>

          <div className="col gap16">
            <section className="card">
              <div className="card-head"><h2>{me.tenant!.role === 'ADMIN' ? 'Your organization’s requests' : 'Your requests'}</h2></div>
              {!tickets.data ? <Loading /> : tickets.data.length === 0 ? <div className="empty">No requests yet.</div> : tickets.data.map((k) => {
                const [label, cls] = TICKET_STATUS[k.status] ?? [k.status, 'neutral'];
                return (
                  <Link key={k.id} href={`${base}/support/${k.id}`} className="row" style={{ gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--line)', textDecoration: 'none', color: 'inherit' }}>
                    <span className="mono tiny muted" style={{ width: 62 }}>{k.ref}</span>
                    <span className="col grow" style={{ gap: 2, minWidth: 0 }}><span className="strong ellipsis">{k.subject}</span><span className="tiny muted">{k.createdByName} · {timeAgo(k.updatedAt)}</span></span>
                    <span className={`badge ${cls}`}>{label}</span>
                  </Link>
                );
              })}
            </section>
            <section className="card">
              <div className="card-head"><h2>Ideas others have asked for</h2></div>
              {!ideas.data ? <Loading /> : ideas.data.length === 0 ? <div className="empty">No ideas yet — send one with “Feature idea”.</div> : ideas.data.map((i) => (
                <div key={i.id} className="row" style={{ gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--line)' }}>
                  <button aria-label={`${i.voted ? 'Remove vote for' : 'Vote for'} ${i.title}`} aria-pressed={i.voted} onClick={() => run(() => api.post(`/support/ideas/${i.id}/vote`)).then(ideas.reload)}
                    className="col" style={{ width: 48, height: 48, borderRadius: 9, border: i.voted ? '1.5px solid var(--ink)' : '1px solid var(--field)', background: i.voted ? 'var(--bg)' : 'var(--surface)', alignItems: 'center', justifyContent: 'center', gap: 0, cursor: 'pointer' }}>
                    <I.Up size={12} /><span className="small strong">{i.votes}</span>
                  </button>
                  <span className="col grow" style={{ gap: 2 }}><span className="strong">{i.title}</span><span className="tiny muted">{({ UNDER_REVIEW: 'Under review', PLANNED: 'Planned', SHIPPED: 'Shipped' } as Record<string, string>)[i.status] ?? i.status}</span></span>
                </div>
              ))}
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
