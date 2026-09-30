'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { longDate, money, relDays } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { PlainLayout, SignOutButton } from '@/components/plain';
import { Confirm, ErrorBox, Loading, useAction, useToast } from '@/components/ui';

const STATUS: Record<string, [string, string]> = {
  ACTIVE: ['Paying', 'ok'], PAST_DUE: ['Paying · payment issue', 'warn'], TRIAL: ['Trial', 'warn'], SUSPENDED: ['Paused', 'neutral'], CANCELLED: ['Cancelled', 'neutral'],
};

export default function PartnersPage() {
  const d = useApi<any>('/partners/me');
  const { busy, run } = useAction();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('connect');
    if (c === 'done') toast.show('Payout account connected. It may take a minute to show as ready.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.show('Copied'); } catch { toast.show('Couldn’t copy — select the text instead', true); }
  };

  return (
    <PlainLayout wide right={<><span className="small muted">Partner portal</span><SignOutButton /></>}>
      {d.error && <ErrorBox error={d.error} retry={d.reload} />}
      {!d.data && !d.error && <Loading />}
      {d.data && (
        <>
          <h1 className="page-title">Hi {d.data.name.split(' ')[0]}</h1>
          <div className="grid g2">
            <section className="card pad col gap14">
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>Your referral link</h2>
              <div className="row gap8">
                <input className="input mono" readOnly value={d.data.referralUrl} onFocus={(e) => e.target.select()} aria-label="Referral link" style={{ fontSize: 13, background: 'var(--bg)' }} />
                <button className="btn primary" onClick={() => copy(d.data.referralUrl)}>Copy</button>
              </div>
              <p className="small muted" style={{ lineHeight: 1.5 }}>
                Anyone who starts a trial within {d.data.cookieDays} days of clicking is yours. You earn {d.data.commissionPercent}% of what they pay (excl. VAT) for their first {d.data.commissionMonths} months.
              </p>
            </section>
            <section className="card pad col gap14">
              <div className="row gap8"><h2 className="grow" style={{ fontSize: 16, fontWeight: 600 }}>Your demo portal</h2>{d.data.demo && <span className="badge warn">Next reset {longDate(d.data.demo.nextReset)} · {relDays(d.data.demo.nextReset.slice(0, 10))}</span>}</div>
              {d.data.demo ? (
                <>
                  <div className="mono small" style={{ color: 'var(--text2)', wordBreak: 'break-all' }}>{d.data.demo.url}</div>
                  <p className="small muted" style={{ lineHeight: 1.5 }}>Your own copy of the sample company to show prospects. It goes back to fresh sample data on the 1st of every month, and anyone who starts a trial after visiting it is tagged with your referral.</p>
                  <div className="row wrap gap8">
                    <a href={d.data.demo.url} target="_blank" rel="noopener noreferrer" className="btn primary">Open my demo</a>
                    <button className="btn" onClick={() => copy(d.data.demo.url)}>Copy demo link</button>
                    <button className="btn" onClick={() => setConfirmReset(true)} disabled={busy}>Reset now</button>
                  </div>
                </>
              ) : <p className="small muted">Your demo portal is being prepared. Contact Lockred if it doesn’t show up.</p>}
            </section>
          </div>

          <div className="grid g4">
            <div className="card pad stat"><span className="stat-label">Link clicks · 30 days</span><span className="stat-value">{d.data.stats.clicks30}</span></div>
            <div className="card pad stat"><span className="stat-label">Trials running</span><span className="stat-value">{d.data.stats.trials}</span></div>
            <div className="card pad stat"><span className="stat-label">Paying customers</span><span className="stat-value">{d.data.stats.paying}</span></div>
            <div className="card pad stat">
              <span className="stat-label">Earned this month</span><span className="stat-value">{money(d.data.stats.thisMonth, d.data.stats.currency)}</span>
              <span className="small muted">{money(d.data.stats.pending, d.data.stats.currency)} waiting for payout</span>
            </div>
          </div>

          <section className="card">
            <div className="card-head">
              <h2>Your referrals</h2>
              {d.data.payouts.stripeConfigured && (d.data.payouts.enabled
                ? <span className="small txt-ok strong">Payout account connected ✓</span>
                : <button className="btn sm primary" disabled={busy} onClick={async () => { const r = await run(() => api.post('/partners/connect')); if (r?.url) window.location.href = r.url; }}>
                    {d.data.payouts.connected ? 'Finish payout setup' : 'Connect payout account'}
                  </button>)}
            </div>
            {d.data.referrals.length === 0 ? (
              <div className="empty">No referrals yet. Share your link or your demo to get started.</div>
            ) : (
              <div className="scroll-x"><div className="table" style={{ minWidth: 680 }}>
                <div className="trow thead" style={{ gridTemplateColumns: COLS }}><span>Organization</span><span>Since</span><span>Plan</span><span>Status</span><span className="right">You’ve earned</span></div>
                {d.data.referrals.map((r: any, i: number) => {
                  const [label, cls] = STATUS[r.status] ?? [r.status, 'neutral'];
                  return (
                    <div key={i} className="trow" style={{ gridTemplateColumns: COLS }}>
                      <span className="strong ellipsis">{r.name}</span>
                      <span className="small">{longDate(r.since)}</span>
                      <span className="small">{r.plan === 'DEMO' ? '—' : r.plan[0] + r.plan.slice(1).toLowerCase()}</span>
                      <span><span className={`badge ${cls}`}>{label}{r.status === 'TRIAL' && r.trialEndsAt ? ` · ends ${relDays(r.trialEndsAt.slice(0, 10))}` : ''}</span></span>
                      <span className="right mono small">{r.earned ? money(r.earned, d.data.stats.currency) : '—'}</span>
                    </div>
                  );
                })}
              </div></div>
            )}
          </section>
          <p className="small muted">Questions about the program? <Link href="mailto:partners@lockred.app">partners@lockred.app</Link></p>
        </>
      )}
      {confirmReset && (
        <Confirm title="Reset your demo now?" text="Everything changed in your demo goes back to fresh sample data. Anyone using it right now will be signed out. The monthly reset on the 1st still happens."
          confirmLabel="Reset demo" danger onConfirm={() => run(() => api.post('/partners/demo/reset'), 'Demo reset').then(d.reload)} onClose={() => setConfirmReset(false)} />
      )}
    </PlainLayout>
  );
}

const COLS = 'minmax(0,1.6fr) 140px 110px minmax(0,1.2fr) 140px';
