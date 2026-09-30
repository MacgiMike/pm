'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useTenant } from '@/lib/context';
import { moneyOf, pct, relDays, shortDate, todayYmd } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { I } from '@/components/icons';
import { Topbar } from '@/components/shell';
import { Avatar, Bar, Drawer, Empty, ErrorBox, HealthBadge, Loading, Modal, useAction, useToast } from '@/components/ui';

interface Row {
  id: string; name: string; status: string; archived: boolean; startDate: string; endDate: string;
  owner: { id: string; name: string } | null; myRole: string;
  nextTollgate: { code: string; name: string; date: string; met: number; total: number } | null;
  taskCount: number; progress: number; planned: number; gap: number; health: string; reasons: string[]; lateTasks: number;
  budget: number | null; spent: number | null; forecast: number | null;
}

export default function PortfolioPage() {
  const { me, base } = useTenant();
  const t = me.tenant!;
  const rows = useApi<Row[]>('/projects');
  const [filter, setFilter] = useState<'all' | 'attn' | 'ok' | 'mine'>('all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [owning, setOwning] = useState<Row | null>(null);
  const seesAll = t.role === 'ADMIN' || t.role === 'MANAGER';
  const canCreate = t.whoCanCreateProjects === 'EVERYONE' || seesAll;

  const list = rows.data ?? [];
  const attn = list.filter((r) => r.health !== 'ON_TRACK');
  const shown = useMemo(() => {
    let xs = filter === 'attn' ? attn : filter === 'ok' ? list.filter((r) => r.health === 'ON_TRACK') : filter === 'mine' ? list.filter((r) => r.myRole !== 'VIEWER') : list;
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      xs = xs.filter((r) => r.name.toLowerCase().includes(s) || r.owner?.name.toLowerCase().includes(s));
    }
    return xs;
  }, [list, attn, filter, q]);

  const withBudget = list.filter((r) => r.budget);
  const totBudget = withBudget.reduce((s, r) => s + (r.budget ?? 0), 0);
  const totSpent = withBudget.reduce((s, r) => s + (r.spent ?? 0), 0);

  return (
    <>
      <Topbar
        crumbs={[{ label: t.name }, { label: 'Portfolio' }]}
        right={
          <label className="row gap8" style={{ height: 36, width: 280, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--faint)' }}>
            <I.Search size={15} />
            <input aria-label="Search projects and owners" placeholder="Search projects or owners" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ border: 0, background: 'transparent', outline: 'none', flex: 1, fontSize: 14, color: 'var(--ink)' }} />
          </label>
        }
      />
      <div className="page">
        <div className="page-head">
          <div className="col gap4 grow">
            <h1 className="page-title">{seesAll ? 'Portfolio' : 'Your projects'}</h1>
            <p className="small muted">
              {list.length} active project{list.length === 1 ? '' : 's'}
              {t.role === 'MANAGER' && ' · you can view every project and change owners'}
              {t.role === 'ADMIN' && ' · as admin you see every project'}
            </p>
          </div>
          {seesAll && <Link href={`${base}/reports`} className="btn">Portfolio report</Link>}
          {canCreate && <button className="btn primary" onClick={() => setCreating(true)}><I.Plus size={14} />New project</button>}
        </div>

        {rows.error && <ErrorBox error={rows.error} retry={rows.reload} />}
        {!rows.data && !rows.error && <Loading />}

        {rows.data && list.length === 0 && (
          <div className="card">
            <Empty
              title={seesAll ? 'No projects yet' : 'You’re not on any project yet'}
              action={canCreate ? <button className="btn primary" onClick={() => setCreating(true)}><I.Plus size={14} />Create your first project</button> : undefined}
            >
              {canCreate ? 'Start by naming the project and its dates. We’ll guide you through directives, KPIs, tollgates, budget and team.' : 'When a project owner adds you, the project shows up here.'}
            </Empty>
          </div>
        )}

        {list.length > 0 && (
          <>
            <div className="grid g4">
              <div className="card pad stat"><span className="stat-label">Active projects</span><span className="stat-value">{list.length}</span><span className="small muted">{list.length - attn.length} on track</span></div>
              <div className="card pad stat"><span className="stat-label">Behind schedule</span><span className="stat-value txt-bad">{list.filter((r) => r.health === 'BEHIND' || r.gap > 5).length}</span><span className="small muted">further behind plan than allowed</span></div>
              <div className="card pad stat"><span className="stat-label">Over budget</span><span className="stat-value txt-bad">{withBudget.filter((r) => (r.spent ?? 0) > (r.budget ?? 0)).length}</span><span className="small muted">spent more than approved</span></div>
              <div className="card pad stat">
                <span className="stat-label">Budget used</span>
                <span className="stat-value">{totBudget ? pct((totSpent / totBudget) * 100) : '—'}</span>
                <span className="small muted">{totBudget ? moneyOf(totSpent, totBudget, t.currency) : 'visible for projects you lead'}</span>
              </div>
            </div>

            {attn.length > 0 && (
              <section className="card pad col gap8" aria-label="Needs attention">
                <h2 style={{ fontSize: 15, fontWeight: 600 }}>Needs your attention</h2>
                {attn.map((r) => (
                  <div key={r.id} className="row wrap" style={{ fontSize: 14, gap: 12 }}>
                    <span className="dot" style={{ background: r.health === 'BEHIND' ? 'var(--red)' : 'var(--amber-mid)' }} />
                    <Link href={`${base}/p/${r.id}`} className="strong" style={{ textDecoration: 'none' }}>{r.name}</Link>
                    <span style={{ color: 'var(--text2)' }}>
                      — {[...r.reasons, r.nextTollgate ? `next: ${r.nextTollgate.code} ${r.nextTollgate.name}, ${shortDate(r.nextTollgate.date)}` : ''].filter(Boolean).join(' · ')}
                    </span>
                    <span className="grow" />
                    <span className="small muted">Owner: {r.owner?.name ?? '—'}</span>
                  </div>
                ))}
              </section>
            )}

            <section className="card" aria-label="All projects">
              <div className="row wrap" style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', gap: 8 }}>
                <div className="chips">
                  {([
                    ['all', 'All', list.length],
                    ['attn', 'Needs attention', attn.length],
                    ['ok', 'On track', list.length - attn.length],
                    ...(seesAll ? [['mine', 'Mine', list.filter((r) => r.myRole !== 'VIEWER').length]] : []),
                  ] as [typeof filter, string, number][]).map(([k, label, n]) => (
                    <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                      {label} <span className="mono" style={{ opacity: 0.75 }}>{n}</span>
                    </button>
                  ))}
                </div>
                <span className="grow" />
                <span className="tiny muted row gap6">
                  <span style={{ width: 18, height: 6, borderRadius: 3, background: 'var(--ink)' }} />done
                  <span style={{ width: 2, height: 12, background: 'var(--red)', marginLeft: 8 }} />where the plan says you should be
                </span>
              </div>
              <div className="scroll-x">
                <div className="table">
                  <div className="trow thead" style={{ gridTemplateColumns: cols(seesAll) }}>
                    <span>Project</span><span>Owner</span><span>Next tollgate</span><span>Schedule</span><span>Budget</span><span>Health</span>{seesAll && <span />}
                  </div>
                  {shown.map((r) => {
                    const bp = r.budget ? Math.round(((r.spent ?? 0) / r.budget) * 100) : null;
                    return (
                      <div key={r.id} className="trow" style={{ gridTemplateColumns: cols(seesAll) }}>
                        <Link href={`${base}/p/${r.id}`} className="strong ellipsis" style={{ textDecoration: 'none' }}>{r.name}</Link>
                        <span className="row gap8" style={{ color: 'var(--text2)', minWidth: 0 }}><Avatar name={r.owner?.name} small /><span className="ellipsis">{r.owner?.name ?? 'No owner'}</span></span>
                        <span className="col" style={{ gap: 2 }}>
                          {r.nextTollgate ? (
                            <>
                              <span className="ellipsis">{r.nextTollgate.code} {r.nextTollgate.name}</span>
                              <span className="tiny muted">{shortDate(r.nextTollgate.date)} · {relDays(r.nextTollgate.date)}</span>
                            </>
                          ) : <span className="muted">—</span>}
                        </span>
                        <span className="col gap6">
                          <Bar value={r.progress} mark={r.planned} size="thin" />
                          <span className="tiny muted">{pct(r.progress)} done · plan {pct(r.planned)}</span>
                        </span>
                        <span className="col gap6">
                          {bp === null ? <span className="tiny muted">{r.budget === null ? 'Owner & co-leads only' : 'No budget set'}</span> : (
                            <>
                              <Bar value={Math.min(100, bp)} size="thin" color={bp > 100 ? 'var(--red)' : bp > 90 ? 'var(--amber-mid)' : undefined} />
                              <span className="tiny muted nowrap">{bp}% · {moneyOf(r.spent, r.budget, t.currency)}</span>
                            </>
                          )}
                        </span>
                        <span><HealthBadge health={r.health} /></span>
                        {seesAll && <button className="btn sm" onClick={() => setOwning(r)}>Change owner</button>}
                      </div>
                    );
                  })}
                  {shown.length === 0 && <div className="empty">No projects match.</div>}
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {creating && <NewProject onClose={() => setCreating(false)} />}
      {owning && <ChangeOwner row={owning} onClose={() => setOwning(null)} onDone={() => { setOwning(null); rows.reload(); }} />}
    </>
  );
}

const cols = (seesAll: boolean) =>
  `minmax(0,2.1fr) minmax(0,1.3fr) minmax(0,1.6fr) minmax(0,1.5fr) minmax(0,1.5fr) 96px${seesAll ? ' 132px' : ''}`;

function NewProject({ onClose }: { onClose: () => void }) {
  const { base } = useTenant();
  const router = useRouter();
  const { busy, run } = useAction();
  const start = todayYmd();
  const end = (() => { const d = new Date(); d.setMonth(d.getMonth() + 6); return d.toISOString().slice(0, 10); })();
  const [f, setF] = useState({ name: '', startDate: start, endDate: end, purpose: '' });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post('/projects', f));
    if (r) router.push(`${base}/p/${r.id}/setup`);
  };
  return (
    <Modal title="New project" subtitle="Only you can see it until you add people. You can change everything later." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="np" disabled={busy}>Create and set up</button></>}>
      <form id="np" className="col gap14" onSubmit={submit}>
        <label className="field">Project name<input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. New warehouse system" /></label>
        <div className="grid g2">
          <label className="field">Start<input className="input" type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
          <label className="field">Planned end<input className="input" type="date" required value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
        </div>
        <label className="field">Why are we doing this? <span className="hint">Optional — one or two sentences everyone can repeat.</span>
          <textarea className="textarea" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} rows={2} />
        </label>
      </form>
    </Modal>
  );
}

function ChangeOwner({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const people = useApi<{ accountId: string; name: string; email: string; role: string; owns: number }[]>('/people');
  const [pick, setPick] = useState<string>('');
  const [reason, setReason] = useState('');
  const [keep, setKeep] = useState(true);
  const { busy, run } = useAction();
  const toast = useToast();
  const candidates = (people.data ?? []).filter((p) => p.accountId !== row.owner?.id);
  const picked = candidates.find((p) => p.accountId === pick);
  const save = async () => {
    if (!picked) return toast.show('Pick the new owner first', true);
    const r = await run(() => api.post(`/projects/${row.id}/owner`, { accountId: picked.accountId, reason, keepAsColead: keep }));
    if (r) {
      toast.show(`${picked.name} now owns ${row.name}. Both have been notified.`);
      onDone();
    }
  };
  return (
    <Drawer title={row.name} kicker="Change owner" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !picked} onClick={save}>{picked ? `Make ${picked.name.split(' ')[0]} owner` : 'Choose someone'}</button></>}>
      <p className="small" style={{ color: 'var(--text2)' }}>Current owner: <strong>{row.owner?.name ?? 'nobody'}</strong></p>
      <fieldset className="col gap8" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="strong small" style={{ marginBottom: 8 }}>New owner</legend>
        {!people.data && <Loading />}
        {candidates.map((p) => (
          <label key={p.accountId} className="row" style={{ gap: 12, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', border: pick === p.accountId ? '1.5px solid var(--ink)' : '1px solid var(--border)', background: pick === p.accountId ? 'var(--bg)' : undefined }}>
            <input type="radio" name="owner" checked={pick === p.accountId} onChange={() => setPick(p.accountId)} style={{ width: 18, height: 18, accentColor: 'var(--ink)' }} />
            <Avatar name={p.name} />
            <span className="col grow" style={{ gap: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</span>
              <span className="tiny muted">Owns {p.owns} project{p.owns === 1 ? '' : 's'}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="field">Reason <span className="hint">Saved in the audit log and sent to both owners.</span>
        <textarea className="textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Omar is on parental leave from 5 Oct." />
      </label>
      {row.owner && <label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Keep {row.owner.name} on the project as co-lead</label>}
      <div className="note">As a manager you can see every project and change who owns it. You can’t edit tasks, budget or access in a project you don’t own.</div>
    </Drawer>
  );
}
