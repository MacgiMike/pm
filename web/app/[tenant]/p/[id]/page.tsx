'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useProject, useTenant } from '@/lib/context';
import { money, pct, relDays, shortDate, timeAgo } from '@/lib/format';
import { I } from '@/components/icons';
import { Topbar } from '@/components/shell';
import { Bar, Confirm, HealthBadge, useAction } from '@/components/ui';

export default function OverviewPage() {
  const { me, base } = useTenant();
  const { data: d, base: pb, reload } = useProject();
  const [archiving, setArchiving] = useState(false);
  const { run } = useAction();
  const s = d.summary;
  const needsSetup = d.status === 'SETUP' && d.can.plan;
  const next = d.nextTollgate ? d.tollgates.find((g: any) => g.id === d.nextTollgate.id) : null;
  const measured = d.kpis.filter((k: any) => k.status !== 'NO_DATA');

  return (
    <>
      <Topbar crumbs={[{ label: me.tenant!.role === 'MEMBER' ? 'Projects' : 'Portfolio', href: base }, { label: d.name }]} />
      <div className="page">
        <div className="row top wrap" style={{ gap: 16 }}>
          <div className="col gap6 grow">
            <div className="row wrap gap8">
              <h1 className="page-title">{d.name}</h1>
              <HealthBadge health={s.health} />
            </div>
            {d.purpose && <p style={{ color: 'var(--text2)', maxWidth: 820 }}>{d.purpose}</p>}
            <p className="small muted">
              Owner {d.owner?.name ?? '—'}{d.sponsor ? ` · Sponsor ${d.sponsor}` : ''} · {shortDate(d.startDate)} – {shortDate(d.endDate)} · {d.memberCount} {d.memberCount === 1 ? 'person' : 'people'}
            </p>
          </div>
          <Link href={`${pb}/report`} className="btn">Status report</Link>
          {d.can.members && <Link href={`${pb}/team`} className="btn">Team &amp; access</Link>}
          {d.can.work && <Link href={`${pb}/plan?new=1`} className="btn primary"><I.Plus size={14} />Add task</Link>}
        </div>

        {needsSetup && (
          <div className="note info row wrap" style={{ gap: 12 }}>
            <I.Target size={18} />
            <span className="grow">Finish setting up the project: directives, KPIs, tollgates, budget and team. It takes a few minutes and everything can be changed later.</span>
            <Link href={`${pb}/setup`} className="btn sm primary">Continue setup</Link>
          </div>
        )}

        <div className="grid g4">
          <div className="card pad stat">
            <span className="stat-label">Progress</span>
            <span className="row gap8" style={{ alignItems: 'baseline' }}>
              <span className="stat-value">{pct(s.progress)}</span>
              {s.taskCount > 0 && (s.gap > 0.5
                ? <span className="small strong txt-bad">{Math.round(s.gap)} pts behind plan</span>
                : <span className="small strong txt-ok">{s.gap < -0.5 ? `${Math.round(-s.gap)} pts ahead` : 'on plan'}</span>)}
            </span>
            <Bar value={s.progress} mark={s.planned} />
          </div>
          <div className="card pad stat">
            <span className="stat-label">Next tollgate</span>
            {next ? (
              <>
                <span className="display" style={{ fontSize: 20, fontWeight: 700 }}>{next.code} {next.name}</span>
                <span className="small" style={{ color: 'var(--text2)' }}>{shortDate(next.date)} · {relDays(next.date)}{next.total ? ` · ${next.met} of ${next.total} criteria met` : ''}</span>
              </>
            ) : <span className="small muted">{d.tollgates.length ? 'All tollgates passed' : 'No tollgates yet'}</span>}
          </div>
          {d.budget ? (
            <Link href={`${pb}/budget`} className="card pad stat" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="stat-label">Budget used</span>
              <span className="row gap8" style={{ alignItems: 'baseline' }}>
                <span className="stat-value">{d.budget.total ? pct((d.budget.spent / d.budget.total) * 100) : '—'}</span>
                <span className="small" style={{ color: 'var(--text2)' }}>{money(d.budget.spent, d.budget.currency)} of {money(d.budget.total, d.budget.currency)}</span>
              </span>
              {d.budget.total > 0 && (
                <span className={`small strong ${d.budget.forecast > d.budget.total ? 'txt-warn' : 'txt-ok'}`}>
                  Forecast {money(d.budget.forecast, d.budget.currency)}{d.budget.forecast > d.budget.total ? ` · ${money(d.budget.forecast - d.budget.total, d.budget.currency)} over` : ''}
                </span>
              )}
            </Link>
          ) : (
            <div className="card pad stat" style={{ background: 'var(--bg)', borderStyle: 'dashed', justifyContent: 'center' }}>
              <span className="stat-label">Budget</span>
              <span className="small" style={{ color: 'var(--text2)' }}>Visible to the owner and co-leads.</span>
            </div>
          )}
          <div className="card pad stat">
            <span className="stat-label">KPIs</span>
            {d.kpis.length ? (
              <>
                <span className="row gap8" style={{ alignItems: 'baseline' }}>
                  <span className="stat-value">{measured.filter((k: any) => k.status === 'ON_TARGET').length} of {measured.length}</span>
                  <span className="small" style={{ color: 'var(--text2)' }}>measured KPIs on target</span>
                </span>
                {d.kpis.length > measured.length && <span className="small muted">{d.kpis.length - measured.length} not measured yet</span>}
              </>
            ) : <span className="small muted">No KPIs for this project</span>}
          </div>
        </div>

        {d.attention.length > 0 && (
          <section className="card pad col gap8" aria-label="Needs attention">
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Needs attention</h2>
            {d.attention.map((a: any, i: number) => (
              <div key={i} className="row small" style={{ gap: 10 }}>
                <span className="dot" style={{ background: a.kind === 'late_task' ? 'var(--red)' : 'var(--amber-mid)' }} />
                {a.taskId ? <Link href={`${pb}/tasks/${a.taskId}`}>{a.text}</Link> : <span>{a.text}</span>}
              </div>
            ))}
          </section>
        )}

        <div className="grid split">
          <section className="card pad col gap14">
            <div className="row"><h2 style={{ fontSize: 16, fontWeight: 600 }} className="grow">Swim lanes</h2><Link href={`${pb}/lanes`} className="small strong">Open board</Link></div>
            {d.lanes.length === 0 ? (
              <p className="small muted">No swim lanes yet. {d.can.plan ? <Link href={`${pb}/lanes`}>Add one</Link> : null}</p>
            ) : d.lanes.map((l: any) => (
              <div key={l.id} className="grid" style={{ gridTemplateColumns: '160px minmax(0,1fr) 120px', gap: 14, alignItems: 'center', fontSize: 14 }}>
                <span className="row gap8 strong ellipsis"><span className="dot" style={{ background: l.color, borderRadius: 3 }} />{l.name}</span>
                <Bar value={l.progress} mark={l.planned} size="thick" color={l.planned - l.progress > 5 ? 'var(--red)' : undefined} />
                <span className="small right" style={{ color: 'var(--text2)' }}><strong style={{ color: 'var(--ink)' }}>{pct(l.progress)}</strong> · plan {pct(l.planned)}</span>
              </div>
            ))}
            <p className="tiny muted">Lane progress is the average of its tasks, weighted by estimated hours. It updates the moment a task changes.</p>
          </section>
          <section className="card pad col gap14">
            <div className="row"><h2 style={{ fontSize: 16, fontWeight: 600 }} className="grow">Tollgates</h2><Link href={`${pb}/plan`} className="small strong">See on timeline</Link></div>
            {d.tollgates.length === 0 && <p className="small muted">No tollgates yet.</p>}
            {d.tollgates.map((g: any) => {
              const isNext = next?.id === g.id;
              return (
                <div key={g.id} className="row small" style={{ gap: 12 }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    ...(g.passedAt ? { background: 'var(--green)', color: '#fff' } : isNext ? { border: '2px solid var(--ink)' } : { background: '#ECEAE4' }),
                  }}>{g.passedAt && <I.Check size={12} strokeWidth={3} />}</span>
                  <span className="mono muted" style={{ width: 34 }}>{g.code}</span>
                  <span className="grow strong ellipsis">{g.name}</span>
                  <span style={{ color: 'var(--text2)' }}>{g.passedAt ? `Passed ${shortDate(g.passedAt)}` : `${shortDate(g.date)}${g.total ? ` · ${g.met}/${g.total}` : ''}`}</span>
                </div>
              );
            })}
          </section>
        </div>

        {d.kpis.length > 0 && (
          <section className="card pad col gap14">
            <div className="row"><h2 style={{ fontSize: 16, fontWeight: 600 }} className="grow">KPIs</h2>{d.role !== 'CONTRIBUTOR' && <Link href={`${pb}/setup?step=2`} className="small strong">Directives &amp; KPIs</Link>}</div>
            <div className="grid g4" style={{ gap: 12 }}>
              {d.kpis.map((k: any) => (
                <div key={k.id} className="col gap4" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg)' }}>
                  <span className="small" style={{ color: 'var(--text2)' }}>{k.name}</span>
                  <span className="row gap6" style={{ alignItems: 'baseline' }}>
                    <span className="mono" style={{ fontSize: 18, fontWeight: 500 }}>{k.latest ? `${fmtNum(k.latest.value)} ${k.unit}` : '—'}</span>
                    <span className="tiny muted">target {k.direction === 'DECREASE' ? '≤' : '≥'} {fmtNum(k.target)} {k.unit}</span>
                  </span>
                  <span className={`tiny strong ${k.status === 'ON_TARGET' ? 'txt-ok' : k.status === 'OFF_TARGET' ? 'txt-bad' : 'muted'}`}>
                    {k.status === 'ON_TARGET' ? 'On target' : k.status === 'OFF_TARGET' ? trend(k) : k.afterGoLive ? 'Measured after go-live' : 'No value yet'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="card">
          <div className="card-head"><h2>Recent activity</h2></div>
          {d.activity.length === 0 ? <div className="empty">Nothing yet.</div> : d.activity.map((a: any) => (
            <div key={a.id} className="row top small" style={{ gap: 12, padding: '10px 20px', borderBottom: '1px solid var(--line)' }}>
              <span className="muted nowrap" style={{ width: 110 }}>{timeAgo(a.createdAt)}</span>
              <span className="grow"><strong>{a.actorName}</strong>{a.viaTaskLink ? ' (via task link)' : ''} {a.kind === 'comment' ? <>commented: “{a.text}”</> : a.text}</span>
              {a.taskId && <Link href={`${pb}/tasks/${a.taskId}`} className="muted">Open</Link>}
            </div>
          ))}
        </section>

        {d.can.archive && (
          <div className="row no-print" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost sm" onClick={() => setArchiving(true)}>{d.archived ? 'Restore project' : 'Archive project'}</button>
          </div>
        )}
      </div>
      {archiving && (
        <Confirm
          title={d.archived ? 'Restore this project?' : 'Archive this project?'}
          text={d.archived ? 'It will show up in the portfolio and reports again.' : 'It disappears from the portfolio and reports, but nothing is deleted. You can restore it any time.'}
          confirmLabel={d.archived ? 'Restore' : 'Archive'}
          onConfirm={async () => { await run(() => api.post(`/projects/${d.id}/archive`, { archived: !d.archived }), d.archived ? 'Project restored' : 'Project archived'); await reload(); }}
          onClose={() => setArchiving(false)}
        />
      )}
    </>
  );
}

function fmtNum(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

function trend(k: any) {
  const v = k.values;
  if (v.length < 2) return 'Not on target yet';
  const a = v[v.length - 2].value, b = v[v.length - 1].value;
  const better = k.direction === 'DECREASE' ? b < a : b > a;
  return better ? 'Improving · not there yet' : b === a ? 'No change yet' : 'Getting worse';
}
