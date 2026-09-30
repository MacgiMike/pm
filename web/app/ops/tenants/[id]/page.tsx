'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { longDate, pct, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { TENANT_STATUS, TICKET_STATUS } from '@/components/ops';
import { ErrorBox, HealthBadge, Loading, Modal, useAction } from '@/components/ui';

export default function OpsTenantPage() {
  const { id } = useParams<{ id: string }>();
  const t = useApi<any>(`/ops/tenants/${id}`);
  const { busy, run } = useAction();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [editSeats, setEditSeats] = useState<number | null>(null);
  const [trialEnd, setTrialEnd] = useState('');

  if (t.error) return <ErrorBox error={t.error} retry={t.reload} />;
  if (!t.data) return <Loading />;
  const d = t.data;
  const [label, cls] = TENANT_STATUS[d.status] ?? [d.status, 'neutral'];
  const patch = (body: Record<string, unknown>, msg: string) => run(() => api.patch(`/ops/tenants/${id}`, body), msg).then(t.reload);

  return (
    <>
      <Link href="/ops" className="small muted">← All tenants</Link>
      <div className="row wrap gap8">
        <h1 className="page-title grow">{d.name}</h1>
        <span className={`badge ${d.isDemo ? 'neutral' : cls}`}>{d.isDemo ? 'Demo' : label}</span>
      </div>
      <p className="small muted">/{d.slug} · created {longDate(d.createdAt)}{d.referredBy ? ` · referred by ${d.referredBy.name} (${d.referredBy.code})` : ''}</p>

      <div className="grid split" style={{ alignItems: 'start' }}>
        <div className="col gap16">
          <section className="card pad col gap14">
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Subscription</h2>
            <div className="grid g3 small">
              <div className="col gap4"><span className="muted">Plan</span><strong>{d.plan}</strong></div>
              <div className="col gap4"><span className="muted">Seats</span><strong>{d.members} used of {d.seats}</strong></div>
              <div className="col gap4"><span className="muted">Trial ends</span><strong>{d.trialEndsAt ? longDate(d.trialEndsAt) : '—'}</strong></div>
              <div className="col gap4"><span className="muted">Stripe customer</span><span className="mono tiny">{d.stripeCustomerId ?? '—'}</span></div>
              <div className="col gap4"><span className="muted">Subscription</span><span className="mono tiny">{d.stripeSubscriptionId ?? '—'}</span></div>
            </div>
            {!d.isDemo && (
              <div className="row wrap gap8">
                <select className="select sm" style={{ width: 170 }} value={d.status} aria-label="Status" onChange={(e) => patch({ status: e.target.value }, 'Status changed')}>
                  {Object.entries(TENANT_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <select className="select sm" style={{ width: 140 }} value={d.plan} aria-label="Plan" onChange={(e) => patch({ plan: e.target.value }, 'Plan changed')}>
                  {['STARTER', 'TEAM', 'BUSINESS'].map((p) => <option key={p}>{p}</option>)}
                </select>
                <button className="btn sm" onClick={() => setEditSeats(d.seats)}>Change seats</button>
                <input className="input sm" type="date" style={{ width: 160 }} value={trialEnd} onChange={(e) => setTrialEnd(e.target.value)} aria-label="New trial end" />
                <button className="btn sm" disabled={!trialEnd || busy} onClick={() => patch({ trialEndsAt: new Date(`${trialEnd}T23:59:00Z`).toISOString(), status: 'TRIAL' }, 'Trial extended')}>Set trial end</button>
              </div>
            )}
            <p className="tiny muted">Changes here are written to the tenant’s audit log as “Lockred support”. Plan and seats normally follow Stripe automatically.</p>
          </section>

          <section className="card">
            <div className="card-head"><h2>Portfolio</h2>{d.supportAccessUntil ? <span className="badge info">Access until {new Date(d.supportAccessUntil).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</span> : null}</div>
            {!d.portfolio ? (
              <div className="empty">Project data is private. The tenant’s admin can let support look for a limited time under Admin → Data &amp; support access.</div>
            ) : d.portfolio.length === 0 ? <div className="empty">No projects.</div> : d.portfolio.map((p: any) => (
              <div key={p.id} className="trow" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) 80px 100px' }}>
                <span className="strong ellipsis">{p.name}</span><span className="small ellipsis">{p.owner?.name ?? '—'}</span><span className="small">{pct(p.progress)}</span><HealthBadge health={p.health} />
              </div>
            ))}
          </section>

          <section className="card">
            <div className="card-head"><h2>Recent audit log</h2></div>
            {d.audit.length === 0 ? <div className="empty">Nothing yet.</div> : d.audit.map((a: any, i: number) => (
              <div key={i} className="row small" style={{ gap: 12, padding: '8px 20px', borderBottom: '1px solid var(--line)' }}>
                <span className="muted nowrap" style={{ width: 110 }}>{timeAgo(a.createdAt)}</span><span className="grow"><strong>{a.actorName}</strong> · <span className="mono tiny">{a.action}</span></span>
              </div>
            ))}
          </section>
        </div>

        <div className="col gap16">
          <section className="card pad col gap8">
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Admins</h2>
            {d.admins.length === 0 && <p className="small muted">No active admin (invitation pending?).</p>}
            {d.admins.map((a: any) => <div key={a.email} className="small"><strong>{a.name}</strong> · <a href={`mailto:${a.email}`}>{a.email}</a></div>)}
          </section>
          <section className="card">
            <div className="card-head"><h2>Support requests</h2></div>
            {d.tickets.length === 0 ? <div className="empty">None.</div> : d.tickets.map((k: any) => {
              const [l, c] = TICKET_STATUS[k.status] ?? [k.status, 'neutral'];
              return (
                <Link key={k.id} href={`/ops/support/${k.id}`} className="row small" style={{ gap: 10, padding: '10px 20px', borderBottom: '1px solid var(--line)', textDecoration: 'none', color: 'inherit' }}>
                  <span className="mono tiny muted">{k.ref}</span><span className="grow ellipsis">{k.subject}</span><span className={`badge ${c}`}>{l}</span>
                </Link>
              );
            })}
          </section>
          <section className="card pad col gap8">
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Danger zone</h2>
            <p className="small muted">Deleting removes every project, file and user membership of this tenant. Suspend or cancel it first.</p>
            <div><button className="btn danger sm" onClick={() => setDeleting(true)}>Delete tenant…</button></div>
          </section>
        </div>
      </div>

      {editSeats !== null && (
        <Modal title="Change seats" narrow onClose={() => setEditSeats(null)}
          footer={<><button className="btn" onClick={() => setEditSeats(null)}>Cancel</button><button className="btn primary" onClick={() => patch({ seats: editSeats }, 'Seats changed').then(() => setEditSeats(null))}>Save</button></>}>
          <input className="input mono" type="number" min={1} value={editSeats} onChange={(e) => setEditSeats(Number(e.target.value) || 1)} aria-label="Seats" />
          <p className="small muted">If the tenant pays through Stripe, change seats in Stripe instead — the next webhook would overwrite this.</p>
        </Modal>
      )}
      {deleting && (
        <Modal title={`Delete ${d.name}?`} narrow onClose={() => setDeleting(false)}
          footer={<><button className="btn" onClick={() => setDeleting(false)}>Cancel</button>
            <button className="btn danger solid" disabled={confirmText !== d.slug || busy} onClick={async () => { const r = await run(() => api.del(`/ops/tenants/${id}?confirm=${encodeURIComponent(confirmText)}`), 'Tenant deleted'); if (r) router.push('/ops'); }}>Delete forever</button></>}>
          <p className="small" style={{ lineHeight: 1.5 }}>This can’t be undone. Type <strong className="mono">{d.slug}</strong> to confirm.</p>
          <input className="input mono" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type the address to confirm" />
        </Modal>
      )}
    </>
  );
}
