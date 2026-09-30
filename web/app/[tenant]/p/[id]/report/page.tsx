'use client';
import { useProject, useTenant } from '@/lib/context';
import { HEALTH, money, pct, shortDate } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { I } from '@/components/icons';
import { Topbar } from '@/components/shell';
import { Bar, download, ErrorBox, HealthBadge, Loading } from '@/components/ui';

export default function ProjectReportPage() {
  const { me, base } = useTenant();
  const { data: proj, base: pb } = useProject();
  const r = useApi<any>(`/projects/${proj.id}/report`);
  const d = r.data;
  return (
    <>
      <Topbar crumbs={[{ label: me.tenant!.role === 'MEMBER' ? 'Projects' : 'Portfolio', href: base }, { label: proj.name, href: pb }, { label: 'Status report' }]} />
      <div className="page">
        <div className="page-head">
          <div className="col gap4 grow">
            <h1 className="page-title">Status report</h1>
            {d && <p className="small muted">{d.project.name} · {d.tenantName} · as of {new Date(d.generatedAt).toLocaleDateString('sv-SE')} · owner {d.project.owner ?? '—'}</p>}
          </div>
          <button className="btn no-print" onClick={() => download(`/projects/${proj.id}/report.csv`)}><I.Download />Tasks (CSV)</button>
          <button className="btn primary no-print" onClick={() => window.print()}><I.Printer />Print / PDF</button>
        </div>
        {r.error && <ErrorBox error={r.error} retry={r.reload} />}
        {!d && !r.error && <Loading />}
        {d && (
          <>
            <div className="card pad row wrap" style={{ gap: 14 }}>
              <HealthBadge health={d.summary.health} />
              <span style={{ color: 'var(--text2)' }}>
                {d.summary.reasons.length ? d.summary.reasons.join(' · ') : `${HEALTH[d.summary.health].label}. Nothing is flagged.`}
              </span>
            </div>
            <div className="grid g3">
              <div className="card pad col gap6">
                <span className="row between small muted">Time plan<span className={`badge ${d.summary.gap > 10 ? 'bad' : d.summary.gap > 5 ? 'warn' : 'ok'}`}>{d.summary.gap > 10 ? 'Behind' : d.summary.gap > 5 ? 'At risk' : 'On track'}</span></span>
                <span style={{ lineHeight: 1.45 }}>{pct(d.summary.progress)} done against {pct(d.summary.planned)} planned. {d.summary.lateTasks ? `${d.summary.lateTasks} task${d.summary.lateTasks === 1 ? ' is' : 's are'} overdue.` : 'No overdue tasks.'}</span>
              </div>
              {d.budget ? (
                <div className="card pad col gap6">
                  <span className="row between small muted">Budget<span className={`badge ${d.budget.total && d.budget.spent > d.budget.total ? 'bad' : d.budget.total && d.budget.forecast > d.budget.total ? 'warn' : 'ok'}`}>{d.budget.total && d.budget.spent > d.budget.total ? 'Over' : d.budget.total && d.budget.forecast > d.budget.total ? 'At risk' : 'On track'}</span></span>
                  <span style={{ lineHeight: 1.45 }}>{d.budget.total ? `${pct((d.budget.spent / d.budget.total) * 100)} spent` : 'No budget set'} with {pct(d.summary.progress)} of the work done. Forecast {money(d.budget.forecast, d.currency)}{d.budget.total ? `, ${d.budget.forecast > d.budget.total ? `${money(d.budget.forecast - d.budget.total, d.currency)} over` : 'within budget'}` : ''}.</span>
                </div>
              ) : <div className="card pad col gap6" style={{ background: 'var(--bg)' }}><span className="small muted">Budget</span><span className="small">Visible to the owner and co-leads.</span></div>}
              <div className="card pad col gap6">
                <span className="row between small muted">KPIs<span className="badge neutral">{d.summary.kpisTotal ? `${d.summary.kpisOnTarget}/${d.summary.kpisMeasured} on target` : 'None'}</span></span>
                <span style={{ lineHeight: 1.45 }}>{d.summary.kpisTotal ? `${d.summary.kpisOnTarget} of ${d.summary.kpisMeasured} measured KPIs are on target${d.summary.kpisTotal > d.summary.kpisMeasured ? `; ${d.summary.kpisTotal - d.summary.kpisMeasured} not measured yet` : ''}.` : 'This project has no KPIs.'}</span>
              </div>
            </div>

            <div className="grid split">
              <figure className="card pad col gap8" style={{ margin: 0 }}>
                <figcaption className="row wrap" style={{ gap: 16, fontWeight: 600 }}>
                  <span className="grow">Planned vs actual progress</span>
                  <span className="row gap6 tiny muted" style={{ fontWeight: 400 }}><span style={{ width: 16, height: 2, background: '#9C9A93' }} />Plan</span>
                  <span className="row gap6 tiny muted" style={{ fontWeight: 400 }}><span style={{ width: 16, height: 3, background: 'var(--ink)' }} />Actual</span>
                </figcaption>
                <SCurve points={d.curve} />
              </figure>
              {d.budget && (
                <section className="card pad col gap8">
                  <h2 style={{ fontSize: 15, fontWeight: 600 }}>Budget by post</h2>
                  {d.budget.posts.length === 0 && <p className="small muted">No budget posts.</p>}
                  {d.budget.posts.map((p: any) => (
                    <div key={p.name} className="grid" style={{ gridTemplateColumns: '150px minmax(0,1fr) 44px', gap: 10, alignItems: 'center', fontSize: 13 }}>
                      <span className="ellipsis">{p.name}</span>
                      <Bar value={Math.min(100, p.pct)} color={p.pct > 100 ? 'var(--red)' : p.pct >= 75 ? 'var(--amber-mid)' : undefined} />
                      <span className="mono right">{p.pct}%</span>
                    </div>
                  ))}
                </section>
              )}
              {!d.budget && (
                <section className="card pad col gap8">
                  <h2 style={{ fontSize: 15, fontWeight: 600 }}>Swim lanes</h2>
                  {d.lanes.map((l: any) => <LaneRow key={l.name} l={l} />)}
                </section>
              )}
            </div>

            <div className="grid g2">
              {d.budget && (
                <section className="card pad col gap8">
                  <h2 style={{ fontSize: 15, fontWeight: 600 }}>Swim lanes</h2>
                  {d.lanes.length === 0 && <p className="small muted">No lanes.</p>}
                  {d.lanes.map((l: any) => <LaneRow key={l.name} l={l} />)}
                </section>
              )}
              <section className="card pad col gap8">
                <h2 style={{ fontSize: 15, fontWeight: 600 }}>Tollgates</h2>
                {d.tollgates.length === 0 && <p className="small muted">No tollgates.</p>}
                {d.tollgates.map((g: any) => (
                  <div key={g.code} className="row small" style={{ gap: 10 }}>
                    <span className="mono muted" style={{ width: 36 }}>{g.code}</span>
                    <span className="grow ellipsis strong">{g.name}</span>
                    <span className="muted">{shortDate(g.date)}</span>
                    <span className={`badge ${g.passed ? 'ok' : g.openTasks ? 'warn' : 'neutral'}`}>{g.passed ? 'Passed' : `${g.met}/${g.total}${g.openTasks ? ` · ${g.openTasks} open` : ''}`}</span>
                  </div>
                ))}
              </section>
            </div>

            {d.kpis.length > 0 && (
              <section className="card">
                <div className="card-head"><h2>KPIs</h2></div>
                <div className="trow thead" style={{ gridTemplateColumns: KCOLS }}><span>KPI</span><span className="right">Baseline</span><span className="right">Latest</span><span className="right">Target</span><span>Status</span></div>
                {d.kpis.map((k: any) => (
                  <div key={k.id} className="trow" style={{ gridTemplateColumns: KCOLS }}>
                    <span className="strong">{k.name}</span>
                    <span className="right mono small">{k.baseline ?? '—'} {k.baseline != null ? k.unit : ''}</span>
                    <span className="right mono small">{k.latest ? `${k.latest.value} ${k.unit}` : '—'}</span>
                    <span className="right mono small">{k.direction === 'DECREASE' ? '≤' : '≥'} {k.target} {k.unit}</span>
                    <span className={`small strong ${k.status === 'ON_TARGET' ? 'txt-ok' : k.status === 'OFF_TARGET' ? 'txt-bad' : 'muted'}`}>{k.status === 'ON_TARGET' ? 'On target' : k.status === 'OFF_TARGET' ? 'Off target' : k.afterGoLive ? 'After go-live' : 'No data'}</span>
                  </div>
                ))}
              </section>
            )}

            <section className="card">
              <div className="card-head"><h2>Overdue tasks</h2><span className="small muted">{d.lateTasks.length}</span></div>
              {d.lateTasks.length === 0 ? <div className="empty">No overdue tasks.</div> : d.lateTasks.map((t: any) => (
                <div key={t.id} className="trow" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) 110px 80px' }}>
                  <span className="strong ellipsis">{t.title}</span><span className="small muted ellipsis">{t.lane ?? '—'}</span>
                  <span className="small txt-bad">Due {shortDate(t.dueDate)}</span><span className="mono small right">{t.progress}%</span>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </>
  );
}

const KCOLS = 'minmax(0,2fr) 110px 110px 110px 120px';

function LaneRow({ l }: { l: any }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: '150px minmax(0,1fr) 100px', gap: 10, alignItems: 'center', fontSize: 13 }}>
      <span className="row gap6 ellipsis"><span className="dot" style={{ background: l.color, borderRadius: 3 }} />{l.name}</span>
      <Bar value={l.progress} mark={l.planned} color={l.planned - l.progress > 5 ? 'var(--red)' : undefined} />
      <span className="right muted">{pct(l.progress)} · plan {pct(l.planned)}</span>
    </div>
  );
}

function SCurve({ points }: { points: { date: string; planned: number; actual: number | null }[] }) {
  if (points.length < 2) return <p className="small muted">Not enough data yet.</p>;
  const W = 560, H = 230, L = 40, R = 16, T = 14, B = 30;
  const t0 = new Date(points[0].date).getTime();
  const t1 = new Date(points[points.length - 1].date).getTime();
  const x = (s: string) => L + ((new Date(s).getTime() - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const planned = points.map((p) => `${x(p.date).toFixed(1)},${y(p.planned).toFixed(1)}`).join(' ');
  const act = points.filter((p) => p.actual !== null);
  const actual = act.map((p) => `${x(p.date).toFixed(1)},${y(p.actual!).toFixed(1)}`).join(' ');
  const last = act[act.length - 1];
  const months = points.filter((_, i) => i === 0 || i === points.length - 1 || points.length < 10 || i % 2 === 0);
  const lastPlanned = last ? points.find((p) => p.date === last.date)?.planned : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Planned progress reaches 100% by ${shortDate(points[points.length - 1].date)}. Actual progress is ${last ? pct(last.actual) : 'not measured yet'}.`}>
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#EFEDE8" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#5C5F67">{v}%</text>
        </g>
      ))}
      {months.map((p) => <text key={p.date} x={x(p.date)} y={H - 10} textAnchor="middle" fontSize="11" fill="#5C5F67">{shortDate(p.date)}</text>)}
      <polyline points={planned} fill="none" stroke="#9C9A93" strokeWidth="2" />
      {act.length > 1 && <polyline points={actual} fill="none" stroke="#16171B" strokeWidth="3" strokeLinejoin="round" />}
      {last && (
        <g>
          <circle cx={x(last.date)} cy={y(last.actual!)} r="4" fill="#16171B" />
          <text x={x(last.date) + 6} y={y(last.actual!) + 16} fontSize="12" fontWeight="600" fill="#16171B">{pct(last.actual)}</text>
          {lastPlanned != null && <text x={x(last.date) + 6} y={y(lastPlanned) - 6} fontSize="12" fill="#5C5F67">plan {pct(lastPlanned)}</text>}
        </g>
      )}
    </svg>
  );
}
