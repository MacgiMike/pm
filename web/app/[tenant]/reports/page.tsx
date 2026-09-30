'use client';
import Link from 'next/link';
import { useTenant } from '@/lib/context';
import { compactMoney, pct, shortDate } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { I } from '@/components/icons';
import { Topbar } from '@/components/shell';
import { download, Empty, ErrorBox, HealthBadge, Loading } from '@/components/ui';

export default function ReportsPage() {
  const { me, base } = useTenant();
  const t = me.tenant!;
  const r = useApi<any>('/reports/portfolio');
  const d = r.data;
  return (
    <>
      <Topbar crumbs={[{ label: t.name, href: base }, { label: 'Reports' }]} />
      <div className="page">
        <div className="page-head">
          <div className="col gap4 grow">
            <h1 className="page-title">Reports</h1>
            <p className="small muted">{t.role === 'MEMBER' ? 'Projects you’re on.' : 'Every active project in the organization.'} Open a project to get its full status report.</p>
          </div>
          <button className="btn no-print" onClick={() => download('/reports/portfolio.csv')}><I.Download />Excel (CSV)</button>
          <button className="btn primary no-print" onClick={() => window.print()}><I.Printer />Print / PDF</button>
        </div>
        {r.error && <ErrorBox error={r.error} retry={r.reload} />}
        {!d && !r.error && <Loading />}
        {d && (
          <>
            <div className="grid g4">
              <div className="card pad stat"><span className="stat-label">Projects</span><span className="stat-value">{d.totals.projects}</span><span className="small muted">{d.totals.onTrack} on track</span></div>
              <div className="card pad stat"><span className="stat-label">At risk</span><span className="stat-value txt-warn">{d.totals.atRisk}</span></div>
              <div className="card pad stat"><span className="stat-label">Behind or over budget</span><span className="stat-value txt-bad">{d.totals.behind}</span><span className="small muted">{d.totals.overBudget} over budget</span></div>
              <div className="card pad stat"><span className="stat-label">Budget used</span><span className="stat-value">{d.totals.budget ? pct((d.totals.spent / d.totals.budget) * 100) : '—'}</span><span className="small muted">{compactMoney(d.totals.spent, d.totals.currency)} of {compactMoney(d.totals.budget, d.totals.currency)}</span></div>
            </div>
            <section className="card">
              <div className="card-head"><h2>Project status</h2><span className="small muted">Generated {new Date(d.generatedAt).toLocaleString('sv-SE')}</span></div>
              {d.rows.length === 0 ? <Empty title="No projects yet" /> : (
                <div className="scroll-x">
                  <div className="table">
                    <div className="trow thead" style={{ gridTemplateColumns: COLS }}>
                      <span>Project</span><span>Owner</span><span className="right">Vs plan</span><span className="right">Budget used</span><span className="right">Forecast</span><span>Next tollgate</span><span>Health</span>
                    </div>
                    {d.rows
                      .slice()
                      .sort((a: any, b: any) => order(a.health) - order(b.health) || b.gap - a.gap)
                      .map((p: any) => {
                        const bud = p.budget ? Math.round((p.spent / p.budget) * 100) : null;
                        const over = p.budget && p.forecast > p.budget;
                        return (
                          <Link key={p.id} href={`${base}/p/${p.id}/report`} className={`trow ${p.health !== 'ON_TRACK' ? 'tint' : ''}`} style={{ gridTemplateColumns: COLS }}>
                            <span className="col" style={{ gap: 2, minWidth: 0 }}>
                              <span className="strong ellipsis">{p.name}</span>
                              {p.reasons.length > 0 && <span className="tiny muted ellipsis">{p.reasons.join(' · ')}</span>}
                            </span>
                            <span className="ellipsis" style={{ color: 'var(--text2)' }}>{p.owner?.name ?? '—'}</span>
                            <span className={`right mono small ${p.gap > d.thresholds.risk ? 'txt-bad' : ''}`}>{p.gap > 0 ? '−' : '+'}{Math.abs(Math.round(p.gap))} pts</span>
                            <span className={`right mono small ${bud !== null && bud > 100 ? 'txt-bad' : ''}`}>{bud === null ? '—' : `${bud}%`}</span>
                            <span className={`right mono small ${over ? 'txt-warn' : ''}`}>{p.forecast === null ? '—' : compactMoney(p.forecast, d.totals.currency)}</span>
                            <span className="small ellipsis">{p.nextTollgate ? `${p.nextTollgate.code} · ${shortDate(p.nextTollgate.date)}` : '—'}</span>
                            <span><HealthBadge health={p.health} /></span>
                          </Link>
                        );
                      })}
                  </div>
                </div>
              )}
              <div className="small muted" style={{ padding: '12px 20px' }}>
                “At risk” = more than {d.thresholds.risk} pts behind plan or forecast over budget. “Behind” = more than {d.thresholds.behind} pts behind or already over budget. Admins can change these under Admin → Reporting rules.
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

const COLS = 'minmax(0,2.2fr) minmax(0,1.2fr) 100px 110px 120px minmax(0,1.2fr) 96px';
const order = (h: string) => (h === 'BEHIND' ? 0 : h === 'AT_RISK' ? 1 : 2);
