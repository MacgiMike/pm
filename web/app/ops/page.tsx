'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { TENANT_STATUS } from '@/components/ops';
import { Loading, Modal, useAction } from '@/components/ui';

export default function OpsTenantsPage() {
  const o = useApi<any>('/ops/overview');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const t = useApi<any[]>(`/ops/tenants${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  const [creating, setCreating] = useState(false);
  const [showDemos, setShowDemos] = useState(false);
  const rows = (t.data ?? []).filter((x) => showDemos || !x.isDemo);

  return (
    <>
      {o.data && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <Stat label="Paying tenants" value={o.data.paying} />
          <Stat label="In trial" value={o.data.trial} />
          <Stat label="Monthly recurring revenue" value={o.data.mrr ? money(o.data.mrr.amount, o.data.mrr.currency) : '—'} hint={o.data.stripeConfigured ? 'estimated from Stripe prices' : 'Stripe not configured'} />
          <Stat label="Payment failed" value={o.data.pastDue} bad={o.data.pastDue > 0} />
          <Stat label="Open support requests" value={o.data.openTickets} hint={<Link href="/ops/support">Open the queue</Link>} />
        </div>
      )}
      <section className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <h2>Tenants</h2>
          <label className="check small"><input type="checkbox" checked={showDemos} onChange={(e) => setShowDemos(e.target.checked)} />Show demos</label>
          <form onSubmit={(e) => { e.preventDefault(); setQuery(q); }} className="row gap6">
            <input className="input sm" style={{ width: 220 }} placeholder="Search name or address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tenants" />
          </form>
          <button className="btn sm primary" onClick={() => setCreating(true)}>Create tenant</button>
        </div>
        {!t.data ? <Loading /> : (
          <div className="scroll-x"><div className="table" style={{ minWidth: 900 }}>
            <div className="trow thead" style={{ gridTemplateColumns: COLS }}><span>Tenant</span><span>Address</span><span>Plan</span><span>Seats</span><span>Projects</span><span>Status</span></div>
            {rows.length === 0 && <div className="empty">No tenants match.</div>}
            {rows.map((x) => {
              const [label, cls] = TENANT_STATUS[x.status] ?? [x.status, 'neutral'];
              return (
                <Link key={x.id} href={`/ops/tenants/${x.id}`} className="trow" style={{ gridTemplateColumns: COLS }}>
                  <span className="col" style={{ gap: 1, minWidth: 0 }}>
                    <span className="strong ellipsis">{x.name}</span>
                    <span className="tiny muted ellipsis">
                      {x.isDemo ? (x.demoOf ? `Demo for ${x.demoOf}` : 'Public demo') : `Since ${shortDate(x.createdAt)}`}
                      {x.referredBy ? ` · via ${x.referredBy.name}` : ''}{x.status === 'TRIAL' && x.trialEndsAt ? ` · trial ends ${shortDate(x.trialEndsAt)}` : ''}
                    </span>
                  </span>
                  <span className="mono tiny ellipsis" style={{ color: 'var(--text2)' }}>/{x.slug}</span>
                  <span className="small">{x.plan[0] + x.plan.slice(1).toLowerCase()}</span>
                  <span className="mono small">{x.isDemo ? '—' : `${x.seatsUsed}/${x.seats}`}</span>
                  <span className="mono small">{x.projects}</span>
                  <span className="row gap6"><span className={`badge ${x.isDemo ? 'neutral' : cls}`}>{x.isDemo ? 'Demo' : label}</span>{x.supportAccess && <span className="badge info">Support access</span>}</span>
                </Link>
              );
            })}
          </div></div>
        )}
      </section>
      {creating && <CreateTenant onClose={() => setCreating(false)} onDone={() => { setCreating(false); t.reload(); o.reload(); }} />}
    </>
  );
}

const COLS = 'minmax(0,1.8fr) minmax(0,1fr) 90px 80px 80px minmax(0,1.2fr)';

function Stat({ label, value, hint, bad }: { label: string; value: React.ReactNode; hint?: React.ReactNode; bad?: boolean }) {
  return (
    <div className="card pad stat" style={{ padding: '14px 18px', gap: 4 }}>
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${bad ? 'txt-bad' : ''}`} style={{ fontSize: 26 }}>{value}</span>
      {hint && <span className="tiny muted">{hint}</span>}
    </div>
  );
}

function CreateTenant({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: '', slug: '', adminName: '', adminEmail: '', plan: 'TEAM', seats: 10, trialDays: 14 });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post('/ops/tenants', { ...f, slug: f.slug || undefined, seats: Number(f.seats), trialDays: Number(f.trialDays) }), 'Tenant created — the admin has been invited');
    if (r) onDone();
  };
  return (
    <Modal title="Create tenant" subtitle="The admin gets an invitation email to set up their account." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="ct" disabled={busy}>Create and invite</button></>}>
      <form id="ct" className="col gap14" onSubmit={submit}>
        <div className="grid g2">
          <label className="field">Organization name<input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">Web address (optional)<input className="input" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder="made from the name" /></label>
          <label className="field">Admin name<input className="input" required value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} /></label>
          <label className="field">Admin email<input className="input" type="email" required value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} /></label>
        </div>
        <div className="grid g3">
          <label className="field">Plan<select className="select" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}><option value="STARTER">Starter</option><option value="TEAM">Team</option><option value="BUSINESS">Business</option></select></label>
          <label className="field">Seats<input className="input" type="number" min={1} value={f.seats} onChange={(e) => setF({ ...f, seats: Number(e.target.value) })} /></label>
          <label className="field">Trial days <span className="hint">0 = active now</span><input className="input" type="number" min={0} value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: Number(e.target.value) })} /></label>
        </div>
      </form>
    </Modal>
  );
}
