'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PointerEvent as RPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useProject, useTenant } from '@/lib/context';
import { pct, shortDate } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { I } from '@/components/icons';
import { Topbar } from '@/components/shell';
import { NewTaskModal } from '@/components/task-form';
import { Avatar, Bar, Empty, ErrorBox, Loading, useToast } from '@/components/ui';

const DAY = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const toYmd = (d: Date) => d.toISOString().slice(0, 10);

interface PlanTask {
  id: string; title: string; laneId: string | null; tollgateId: string | null; startDate: string | null; dueDate: string | null;
  estimateHours: number | null; progress: number; assignee: { id: string; name: string; initials: string } | null; behind: boolean; late: boolean;
}

export default function PlanPage() {
  const { me, base } = useTenant();
  const { data: proj, base: pb, reload: reloadProject } = useProject();
  const plan = useApi<any>(`/projects/${proj.id}/plan`);
  const [view, setView] = useState<'timeline' | 'list'>('timeline');
  const [adding, setAdding] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1' && proj.can.work) setAdding(true);
  }, [proj.can.work]);

  return (
    <>
      <Topbar crumbs={[{ label: me.tenant!.role === 'MEMBER' ? 'Projects' : 'Portfolio', href: base }, { label: proj.name, href: pb }, { label: 'Plan & tollgates' }]} />
      <div className="page">
        <div className="page-head">
          <h1 className="page-title grow">Plan</h1>
          <div className="seg" role="group" aria-label="View">
            <button aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
            <button aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>Timeline</button>
          </div>
          {proj.can.plan && <Link href={`${pb}/setup?step=3`} className="btn"><I.Diamond size={14} />Tollgates</Link>}
          {proj.can.work && <button className="btn primary" onClick={() => setAdding(true)}><I.Plus size={14} />Add task</button>}
        </div>
        {plan.error && <ErrorBox error={plan.error} retry={plan.reload} />}
        {!plan.data && !plan.error && <Loading />}
        {plan.data && plan.data.tasks.length === 0 && (
          <div className="card"><Empty title="No tasks yet" action={proj.can.work ? <button className="btn primary" onClick={() => setAdding(true)}><I.Plus size={14} />Add the first task</button> : undefined}>
            Tasks with a start and due date show up on the timeline. Group them in swim lanes to see progress per workstream.
          </Empty></div>
        )}
        {plan.data && plan.data.tasks.length > 0 && (view === 'timeline'
          ? <Timeline data={plan.data} canEdit={proj.can.work} onChanged={() => { plan.reload(); reloadProject(); }} />
          : <PlanList data={plan.data} />)}
      </div>
      {adding && <NewTaskModal onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); plan.reload(); reloadProject(); router.replace(`${pb}/plan`); void id; }} />}
    </>
  );
}

function groupRows(data: any) {
  const rows: ({ kind: 'lane'; id: string | null; name: string; color: string; progress: number } | { kind: 'task'; t: PlanTask })[] = [];
  const lanes = [...data.lanes, ...(data.tasks.some((t: PlanTask) => !t.laneId) ? [{ id: null, name: 'No lane', color: '#9C9A93' }] : [])];
  for (const l of lanes) {
    const ts: PlanTask[] = data.tasks.filter((t: PlanTask) => t.laneId === l.id);
    if (!ts.length) continue;
    const w = (t: PlanTask) => (t.estimateHours && t.estimateHours > 0 ? t.estimateHours : 1);
    const tot = ts.reduce((s, t) => s + w(t), 0);
    rows.push({ kind: 'lane', id: l.id, name: l.name, color: l.color, progress: ts.reduce((s, t) => s + t.progress * w(t), 0) / tot });
    for (const t of ts) rows.push({ kind: 'task', t });
  }
  return rows;
}

function Timeline({ data, canEdit, onChanged }: { data: any; canEdit: boolean; onChanged: () => void }) {
  const { base: pb } = useProject();
  const toast = useToast();
  const router = useRouter();
  const rows = useMemo(() => groupRows(data), [data]);

  // Range: project dates, widened to include all tasks, snapped to whole months.
  const dates = [data.project.startDate, data.project.endDate, ...data.tasks.flatMap((t: PlanTask) => [t.startDate, t.dueDate])].filter(Boolean) as string[];
  const minD = toDate(dates.reduce((a, b) => (a < b ? a : b)));
  const maxD = toDate(dates.reduce((a, b) => (a > b ? a : b)));
  const start = new Date(Date.UTC(minD.getUTCFullYear(), minD.getUTCMonth(), 1));
  const end = new Date(Date.UTC(maxD.getUTCFullYear(), maxD.getUTCMonth() + 1, 1));
  const days = Math.round((end.getTime() - start.getTime()) / DAY);
  const px = Math.max(6, Math.min(28, 1100 / days));
  const width = days * px;
  const x = (s: string) => ((toDate(s).getTime() - start.getTime()) / DAY) * px;

  const months: { label: string; w: number }[] = [];
  for (let d = new Date(start); d < end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    months.push({ label: `${MONTHS[d.getUTCMonth()]}${d.getUTCMonth() === 0 || months.length === 0 ? ` ${d.getUTCFullYear()}` : ''}`, w: ((next.getTime() - d.getTime()) / DAY) * px });
  }

  // Drag state
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; x0: number; moved: boolean } | null>(null);
  const [delta, setDelta] = useState<{ id: string; mode: 'move' | 'resize'; days: number } | null>(null);

  const onDown = (e: RPointerEvent, t: PlanTask) => {
    if (!canEdit || !t.startDate || !t.dueDate) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mode = e.clientX > rect.right - 10 ? 'resize' : 'move';
    drag.current = { id: t.id, mode, x0: e.clientX, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const days = Math.round((e.clientX - d.x0) / px);
    if (Math.abs(e.clientX - d.x0) > 3) d.moved = true;
    setDelta({ id: d.id, mode: d.mode, days });
  };
  const onUp = async (t: PlanTask) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved || !delta || delta.days === 0) {
      setDelta(null);
      if (!d?.moved) router.push(`${pb}/tasks/${t.id}`);
      return;
    }
    const s = toDate(t.startDate!), e = toDate(t.dueDate!);
    const body = delta.mode === 'move'
      ? { startDate: toYmd(new Date(s.getTime() + delta.days * DAY)), dueDate: toYmd(new Date(e.getTime() + delta.days * DAY)) }
      : { dueDate: toYmd(new Date(Math.max(s.getTime(), e.getTime() + delta.days * DAY))) };
    try {
      await api.patch(`/projects/${data.project.id}/tasks/${t.id}`, body);
      toast.show(delta.mode === 'move' ? `Moved “${t.title}” ${delta.days > 0 ? 'later' : 'earlier'} by ${Math.abs(delta.days)} days` : `New due date ${shortDate(body.dueDate)}`);
      onChanged();
    } catch (err) {
      toast.show((err as Error).message, true);
    } finally {
      setDelta(null);
    }
  };

  const today = data.today as string;
  const todayX = today >= toYmd(start) && today < toYmd(end) ? x(today) : null;
  const H = 52 + rows.length * 40;

  return (
    <>
      <section className="card gantt" aria-label="Timeline">
        <div className="gantt-left">
          <div className="gantt-row thead" style={{ height: 52, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 44px 56px', gap: 10, padding: '0 16px', alignItems: 'end', paddingBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>
            <span>Task</span><span>Who</span><span className="right">Done</span>
          </div>
          {rows.map((r, i) =>
            r.kind === 'lane' ? (
              <div key={`l${i}`} className="gantt-row strong small" style={{ gap: 8, padding: '0 16px', background: 'var(--bg)' }}>
                <span className="dot" style={{ background: r.color, borderRadius: 3, width: 10, height: 10 }} />{r.name}<span className="muted" style={{ fontWeight: 400 }}>· {pct(r.progress)}</span>
              </div>
            ) : (
              <Link key={r.t.id} href={`${pb}/tasks/${r.t.id}`} className="gantt-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 44px 56px', gap: 10, padding: '0 16px 0 34px', textDecoration: 'none', color: 'inherit', fontSize: 14 }}>
                <span className="ellipsis">{r.t.title}</span>
                <span>{r.t.assignee ? <Avatar name={r.t.assignee.name} small /> : <span className="muted tiny">—</span>}</span>
                <span className={`right mono small ${r.t.behind || r.t.late ? 'txt-bad strong' : ''}`}>{r.t.progress}%</span>
              </Link>
            ),
          )}
        </div>
        <div className="gantt-right">
          <div style={{ width, position: 'relative', height: H }}>
            <div style={{ display: 'flex', height: 52, borderBottom: '1px solid var(--border)' }}>
              {months.map((m, i) => (
                <div key={i} style={{ width: m.w, flexShrink: 0, borderLeft: '1px solid var(--line)', padding: '8px 10px', fontSize: 13, fontWeight: 600, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden' }}>{m.label}</div>
              ))}
            </div>
            {rows.map((r, i) => (
              <div key={i} style={{ position: 'absolute', top: 52 + i * 40, left: 0, right: 0, height: 40, borderBottom: '1px solid var(--line)', background: r.kind === 'lane' ? 'var(--bg)' : undefined }}>
                {r.kind === 'task' && r.t.startDate && r.t.dueDate && (() => {
                  const t = r.t;
                  const dd = delta?.id === t.id ? delta : null;
                  const left = x(t.startDate!) + (dd?.mode === 'move' ? dd.days * px : 0);
                  const w = Math.max(px, x(t.dueDate!) - x(t.startDate!) + px + (dd?.mode === 'resize' ? dd.days * px : 0));
                  return (
                    <span
                      className={`gbar ${t.behind ? 'behind' : ''} ${t.progress === 100 ? 'done' : ''}`}
                      style={{ left, width: w, cursor: canEdit ? 'grab' : 'pointer', touchAction: 'none' }}
                      title={`${t.title}: ${shortDate(t.startDate)} – ${shortDate(t.dueDate)}${t.behind ? ' · behind' : ''}`}
                      role="link"
                      tabIndex={0}
                      aria-label={`${t.title}, ${shortDate(t.startDate)} to ${shortDate(t.dueDate)}, ${t.progress}% done`}
                      onKeyDown={(e) => e.key === 'Enter' && router.push(`${pb}/tasks/${t.id}`)}
                      onPointerDown={(e) => onDown(e, t)}
                      onPointerMove={onMove}
                      onPointerUp={() => onUp(t)}
                    >
                      <span style={{ width: `${t.progress}%` }} />
                      {canEdit && <i style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }} />}
                    </span>
                  );
                })()}
                {r.kind === 'task' && (!r.t.startDate || !r.t.dueDate) && (
                  <span className="tiny muted" style={{ position: 'absolute', left: 12, top: 12 }}>No dates — open the task to plan it</span>
                )}
              </div>
            ))}
            {data.tollgates.map((g: any) => (
              <div key={g.id}>
                <div style={{ position: 'absolute', top: 0, height: H, width: 0, borderLeft: `2px dashed ${g.passed ? 'var(--green)' : 'var(--ink)'}`, left: x(g.date), opacity: 0.55, pointerEvents: 'none' }} />
                <div className="row gap4" style={{ position: 'absolute', top: 28, left: x(g.date), transform: 'translateX(-50%)', padding: '2px 6px', borderRadius: 5, background: g.passed ? 'var(--green)' : 'var(--ink)', color: '#fff', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  <I.Diamond size={9} />{g.code} {g.name}
                </div>
              </div>
            ))}
            {todayX !== null && (
              <>
                <div style={{ position: 'absolute', top: 0, height: H, width: 2, background: 'var(--red)', left: todayX, pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: 4, left: todayX, transform: 'translateX(-50%)', padding: '2px 6px', borderRadius: 5, background: 'var(--red)', color: '#fff', fontSize: 11, fontWeight: 600 }}>Today</div>
              </>
            )}
          </div>
        </div>
      </section>
      <div className="row wrap tiny muted" style={{ gap: 20 }}>
        <span className="row gap6"><span style={{ width: 24, height: 10, borderRadius: 3, background: '#d9d6ce', position: 'relative', overflow: 'hidden', display: 'inline-block' }}><span style={{ position: 'absolute', inset: 0, width: '60%', background: 'var(--ink)' }} /></span>Dark part = done</span>
        <span className="row gap6"><span style={{ width: 24, height: 10, borderRadius: 3, border: '2px solid var(--red)', display: 'inline-block' }} />Behind — should be further along by today</span>
        <span className="row gap6"><span style={{ width: 0, height: 14, borderLeft: '2px dashed var(--ink)', display: 'inline-block' }} />Tollgate</span>
        <span className="grow" />
        {canEdit && <span>Drag a bar to move it · drag its right end to change the due date · click to open</span>}
      </div>
    </>
  );
}

function PlanList({ data }: { data: any }) {
  const { base: pb } = useProject();
  const rows = groupRows(data);
  const gate = (id: string | null) => data.tollgates.find((g: any) => g.id === id);
  return (
    <section className="card scroll-x">
      <div className="table">
        <div className="trow thead" style={{ gridTemplateColumns: LCOLS }}><span>Task</span><span>Responsible</span><span>Start</span><span>Due</span><span>Tollgate</span><span>Progress</span></div>
        {rows.map((r, i) => r.kind === 'lane' ? (
          <div key={`l${i}`} className="trow strong small" style={{ gridTemplateColumns: '1fr', background: 'var(--bg)' }}>
            <span className="row gap8"><span className="dot" style={{ background: r.color, borderRadius: 3 }} />{r.name} <span className="muted" style={{ fontWeight: 400 }}>· {pct(r.progress)}</span></span>
          </div>
        ) : (
          <Link key={r.t.id} href={`${pb}/tasks/${r.t.id}`} className="trow" style={{ gridTemplateColumns: LCOLS }}>
            <span className="ellipsis" style={{ paddingLeft: 18 }}>{r.t.title}</span>
            <span className="ellipsis small" style={{ color: 'var(--text2)' }}>{r.t.assignee?.name ?? '—'}</span>
            <span className="small">{shortDate(r.t.startDate)}</span>
            <span className={`small ${r.t.late ? 'txt-bad strong' : ''}`}>{shortDate(r.t.dueDate)}</span>
            <span className="small mono">{gate(r.t.tollgateId)?.code ?? '—'}</span>
            <span className="row gap8"><span className="grow"><Bar value={r.t.progress} size="thin" color={r.t.behind ? 'var(--red)' : undefined} /></span><span className="mono tiny" style={{ width: 34, textAlign: 'right' }}>{r.t.progress}%</span></span>
          </Link>
        ))}
      </div>
    </section>
  );
}

const LCOLS = 'minmax(0,2.4fr) minmax(0,1.2fr) 90px 90px 80px minmax(140px,1fr)';
