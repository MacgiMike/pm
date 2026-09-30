'use client';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { Confirm, Loading, Modal, useAction } from '@/components/ui';

export default function OpsAffiliatesPage() {
  const a = useApi<any[]>('/ops/affiliates');
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<any>(null);
  const { run } = useAction();
  return (
    <>
      <section className="card">
        <div className="card-head"><h2>Affiliate partners</h2><button className="btn sm primary" onClick={() => setCreating(true)}>Add partner</button></div>
        {!a.data ? <Loading /> : a.data.length === 0 ? <div className="empty">No partners yet. Each partner gets a referral link and their own demo portal that resets monthly.</div> : (
          <div className="scroll-x"><div className="table" style={{ minWidth: 1000 }}>
            <div className="trow thead" style={{ gridTemplateColumns: COLS }}><span>Partner</span><span>Code</span><span>Terms</span><span>Clicks 30d</span><span>Referred / paying</span><span className="right">Pending</span><span className="right">Paid</span><span /></div>
            {a.data.map((x) => (
              <div key={x.id} className="trow" style={{ gridTemplateColumns: COLS, opacity: x.status === 'PAUSED' ? 0.6 : 1 }}>
                <span className="col" style={{ gap: 1, minWidth: 0 }}><span className="strong ellipsis">{x.name}</span><span className="tiny muted ellipsis">{x.email}</span></span>
                <span className="col" style={{ gap: 1 }}><span className="mono small">{x.code}</span>{x.demoUrl && <a href={x.demoUrl} target="_blank" rel="noopener noreferrer" className="tiny">demo</a>}</span>
                <span className="small">{x.commissionPercent}% · {x.commissionMonths} mo</span>
                <span className="mono small">{x.clicks30}</span>
                <span className="mono small">{x.referrals} / {x.paying}</span>
                <span className="right mono small">{money(x.pending, x.currency)}</span>
                <span className="right mono small">{money(x.paid, x.currency)}</span>
                <span className="row gap4" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn sm" disabled={!x.pending || !x.payoutsEnabled} title={x.payoutsEnabled ? '' : 'Partner hasn’t connected a payout account'} onClick={() => setPaying(x)}>Pay out</button>
                  <button className="btn sm" onClick={() => run(() => api.patch(`/ops/affiliates/${x.id}`, { status: x.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }), x.status === 'ACTIVE' ? 'Partner paused' : 'Partner active').then(a.reload)}>{x.status === 'ACTIVE' ? 'Pause' : 'Resume'}</button>
                </span>
              </div>
            ))}
          </div></div>
        )}
        <p className="tiny muted" style={{ padding: '10px 20px' }}>Commission is created automatically when a referred customer’s invoice is paid in Stripe. Payouts go to the partner’s Stripe Connect account.</p>
      </section>
      {creating && <AddPartner onClose={() => setCreating(false)} onDone={() => { setCreating(false); a.reload(); }} />}
      {paying && <Confirm title={`Pay ${paying.name}?`} text={`Transfers ${money(paying.pending, paying.currency)} to their Stripe account now.`} confirmLabel="Transfer" onConfirm={() => run(() => api.post(`/ops/affiliates/${paying.id}/payout`), 'Payout sent').then(a.reload)} onClose={() => setPaying(null)} />}
    </>
  );
}

const COLS = 'minmax(0,1.6fr) 110px 110px 90px 120px 120px 120px 170px';

function AddPartner({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: '', email: '', code: '', commissionPercent: '', commissionMonths: '' });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { name: f.name, email: f.email };
    if (f.code) body.code = f.code;
    if (f.commissionPercent) body.commissionPercent = Number(f.commissionPercent);
    if (f.commissionMonths) body.commissionMonths = Number(f.commissionMonths);
    const r = await run(() => api.post('/ops/affiliates', body), 'Partner added — they’ve been emailed, and their demo portal is ready');
    if (r) onDone();
  };
  return (
    <Modal title="Add affiliate partner" subtitle="They get an email to set a password, a referral link and their own demo portal." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="ap" disabled={busy}>Add partner</button></>}>
      <form id="ap" className="col gap14" onSubmit={submit}>
        <div className="grid g2">
          <label className="field">Name<input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">Email<input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        </div>
        <div className="grid g3">
          <label className="field">Referral code <span className="hint">Optional</span><input className="input mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} placeholder="anna-k" /></label>
          <label className="field">Commission % <span className="hint">Default from settings</span><input className="input" type="number" min={0} max={100} value={f.commissionPercent} onChange={(e) => setF({ ...f, commissionPercent: e.target.value })} /></label>
          <label className="field">For months <span className="hint">Default from settings</span><input className="input" type="number" min={1} max={120} value={f.commissionMonths} onChange={(e) => setF({ ...f, commissionMonths: e.target.value })} /></label>
        </div>
      </form>
    </Modal>
  );
}
