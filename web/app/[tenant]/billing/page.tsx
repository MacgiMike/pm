'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useTenant } from '@/lib/context';
import { longDate, money } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { I } from '@/components/icons';
import { Topbar } from '@/components/shell';
import { Bar, ErrorBox, Loading, Modal, useAction, useToast } from '@/components/ui';

const STATUS: Record<string, [string, string]> = {
  TRIAL: ['Free trial', 'info'], ACTIVE: ['Active', 'ok'], PAST_DUE: ['Payment failed', 'bad'], SUSPENDED: ['Paused', 'neutral'], CANCELLED: ['Cancelled', 'neutral'],
};

export default function BillingPage() {
  const { me, base, reloadMe } = useTenant();
  const b = useApi<any>('/billing');
  const { busy, run } = useAction();
  const toast = useToast();
  const [seatsOpen, setSeatsOpen] = useState(false);
  const [plan, setPlan] = useState<string>('TEAM');

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('done') === '1') {
      toast.show('Thanks! Your subscription is being activated.');
      setTimeout(() => { b.reload(); reloadMe(); }, 2500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (me.tenant!.role !== 'ADMIN') return <div className="page"><div className="card pad">Only admins can manage billing.</div></div>;

  const go = async (fn: () => Promise<{ url: string }>) => {
    const r = await run(fn);
    if (r?.url) window.location.href = r.url;
  };

  return (
    <>
      <Topbar crumbs={[{ label: me.tenant!.name, href: base }, { label: 'Billing' }]} />
      <div className="page">
        <h1 className="page-title">Billing</h1>
        {b.error && <ErrorBox error={b.error} retry={b.reload} />}
        {!b.data && !b.error && <Loading />}
        {b.data && b.data.isDemo && <div className="note">This is a demo organization — there’s nothing to pay. <a href="/signup" className="strong">Start your own free trial</a>.</div>}
        {b.data && !b.data.isDemo && (() => {
          const d = b.data;
          const [label, cls] = STATUS[d.status] ?? [d.status, 'neutral'];
          const current = d.plans.find((p: any) => p.id === d.plan);
          return (
            <>
              {!d.enabled && <div className="note warn">Online payment isn’t switched on for this server yet. Contact Lockred to activate your subscription.</div>}
              <div className="grid split">
                <section className="card pad col gap14">
                  <div className="row"><span className="small muted grow">Current plan</span><span className={`badge ${cls}`}>{label}</span></div>
                  <div className="row wrap gap8" style={{ alignItems: 'baseline' }}>
                    <span className="display" style={{ fontSize: 30, fontWeight: 700 }}>{d.status === 'TRIAL' ? 'Free trial' : current?.name ?? d.plan}</span>
                    {current?.price && d.status !== 'TRIAL' && <span style={{ color: 'var(--text2)' }}>{money(current.price.amount, current.price.currency)} per seat / {current.price.interval}</span>}
                  </div>
                  {d.status === 'TRIAL' && d.trialEndsAt && <p className="small" style={{ color: 'var(--text2)' }}>Ends {longDate(d.trialEndsAt)}. Choose a plan below to keep going — nothing changes for your team.</p>}
                  <div className="col gap6">
                    <span className="row between small"><span>Seats</span><span><strong>{d.seatsUsed}</strong> of {d.seats} used</span></span>
                    <Bar value={d.seats ? (d.seatsUsed / d.seats) * 100 : 0} color={d.seatsUsed >= d.seats ? 'var(--amber-mid)' : undefined} />
                    <span className="tiny muted">People with a task link are free and don’t use seats.</span>
                  </div>
                  <div className="row wrap gap8">
                    <button className="btn primary" onClick={() => setSeatsOpen(true)} disabled={!d.enabled && d.status !== 'TRIAL'}>Change seats</button>
                    {d.hasSubscription && <button className="btn" onClick={() => go(() => api.post('/billing/portal'))} disabled={busy}>Manage billing<I.External size={14} /></button>}
                  </div>
                </section>
                <section className="card pad col gap14">
                  <span className="small muted">Payment method</span>
                  {d.paymentMethod ? (
                    <div className="row gap8">
                      <span style={{ width: 44, height: 30, borderRadius: 5, background: '#ECEAE4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><I.Card size={20} /></span>
                      <span className="col" style={{ gap: 1 }}><span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{d.paymentMethod.brand} ending {d.paymentMethod.last4}</span><span className="small muted">Expires {String(d.paymentMethod.expMonth).padStart(2, '0')}/{String(d.paymentMethod.expYear).slice(-2)}</span></span>
                    </div>
                  ) : <p className="small muted">None yet — you’ll add one when you choose a plan.</p>}
                  {d.hasSubscription && <div><button className="btn" onClick={() => go(() => api.post('/billing/portal'))} disabled={busy}>Update in secure billing portal<I.External size={14} /></button></div>}
                  <p className="small muted" style={{ lineHeight: 1.5 }}>Payments are handled by Stripe. Lockred never sees or stores your card number. Invoices include VAT where applicable.</p>
                </section>
              </div>

              {d.enabled && (!d.hasSubscription || d.status === 'CANCELLED') && (
                <section className="card">
                  <div className="card-head"><h2>Choose a plan</h2></div>
                  <div className="grid g3" style={{ gap: 0 }}>
                    {d.plans.map((p: any, i: number) => (
                      <label key={p.id} className="col gap8" style={{ padding: '18px 20px', borderRight: i < d.plans.length - 1 ? '1px solid var(--line)' : undefined, background: plan === p.id ? 'var(--bg)' : undefined, cursor: 'pointer' }}>
                        <span className="row gap8"><input type="radio" name="plan" checked={plan === p.id} onChange={() => setPlan(p.id)} style={{ accentColor: 'var(--ink)', width: 18, height: 18 }} /><strong style={{ fontSize: 16 }}>{p.name}</strong></span>
                        <span style={{ color: 'var(--text2)' }}>{p.price ? `${money(p.price.amount, p.price.currency)} / seat / ${p.price.interval}` : 'Price not set'}</span>
                        <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>{p.features.map((f: string) => <li key={f}>{f}</li>)}</ul>
                      </label>
                    ))}
                  </div>
                  <div className="row" style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', justifyContent: 'flex-end', gap: 10 }}>
                    <span className="small muted grow">You’ll pay for {Math.max(d.seats, d.seatsUsed)} seats. You can change this any time.</span>
                    <button className="btn primary" disabled={busy || !d.plans.find((p: any) => p.id === plan)?.price} onClick={() => go(() => api.post('/billing/checkout', { plan, seats: Math.max(d.seats, d.seatsUsed) }))}>Continue to payment</button>
                  </div>
                </section>
              )}

              {d.invoices.length > 0 && (
                <section className="card">
                  <div className="card-head"><h2>Invoices</h2></div>
                  {d.invoices.map((i: any) => (
                    <div key={i.id} className="trow" style={{ gridTemplateColumns: '130px minmax(0,1fr) 140px 100px 80px' }}>
                      <span className="small">{longDate(i.date)}</span>
                      <span className="small muted">{i.number ?? '—'}</span>
                      <span className="mono small">{money(i.amount, i.currency)}</span>
                      <span className={`small strong ${i.status === 'paid' ? 'txt-ok' : i.status === 'open' ? 'txt-warn' : ''}`}>{i.status === 'paid' ? 'Paid' : i.status === 'open' ? 'Open' : i.status}</span>
                      {i.pdf ? <a href={i.pdf} target="_blank" rel="noopener noreferrer" className="small">PDF</a> : <span />}
                    </div>
                  ))}
                </section>
              )}
            </>
          );
        })()}
      </div>
      {seatsOpen && b.data && <Seats current={b.data.seats} used={b.data.seatsUsed} onClose={() => setSeatsOpen(false)} onDone={() => { setSeatsOpen(false); b.reload(); }} />}
    </>
  );
}

function Seats({ current, used, onClose, onDone }: { current: number; used: number; onClose: () => void; onDone: () => void }) {
  const [n, setN] = useState(current);
  const { busy, run } = useAction();
  return (
    <Modal title="Change seats" narrow onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || n === current || n < used} onClick={async () => { const r = await run(() => api.post('/billing/seats', { seats: n }), 'Seats updated'); if (r) onDone(); }}>Save</button></>}>
      <div className="row gap8" style={{ justifyContent: 'center' }}>
        <button className="btn" aria-label="Fewer seats" onClick={() => setN(Math.max(used, n - 1))}>−</button>
        <input className="input mono" style={{ width: 100, textAlign: 'center', fontSize: 22 }} type="number" min={used} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} aria-label="Seats" />
        <button className="btn" aria-label="More seats" onClick={() => setN(n + 1)}>+</button>
      </div>
      <p className="small muted" style={{ textAlign: 'center' }}>{used} in use. Changes are prorated on your next invoice.</p>
    </Modal>
  );
}
