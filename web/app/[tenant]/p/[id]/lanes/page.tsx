'use client';
import Link from 'next/link';
import { DragEvent, FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { useProject, useTenant } from '@/lib/context';
import { pct, shortDate, weighted } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { I } from '@/components/icons';
import { Topbar } from '@/components/shell';
import { NewTaskModal } from '@/components/task-form';
import { Avatar, Bar, Confirm, Empty, ErrorBox, Loading, Modal, useAction, useToast } from '@/components/ui';

interface Card {
  id: string; title: string; progress: number; estimateHours: number | null; dueDate: string | null; late: boolean;
  assignee: { id: string; name: string; initials: string } | null; guest: { name: string; org: string; initials: string } | null;
}
interface Lane { id: string | null; name: string; color: string; leadName: string | null; hours: number; progress: number; planned: number; budgetPosts: string[]; tasks: Card[] }

const COLS = [
  { key: 'todo', label: 'To do', test: (p: number) => p === 0, drop: (p: number) => 0 },
  { key: 'doing', label: 'In progress', test: (p: number) => p > 0 && p < 100, drop: (p: number) => (p === 0 ? 25 : p === 100 ? 75 : p) },
  { key: 'done', label: 'Done', test: (p: number) => p === 100, drop: () => 100 },
];

export default function LanesPage() {
  const { me, base } = useTenant();
  const { data: proj, base: pb, reload: reloadProject } = useProject();
  const board = useApi<{ role: string; can: any; progress: number; lanes: Lane[] }>(`/projects/${proj.id}/board`);
  const toast = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [addingIn, setAddingIn] = useState<string | null | undefined>(undefined);
  const [laneEdit, setLaneEdit] = useState<Lane | 'new' | null>(null);
  const can = proj.can;

  const lanes = board.data?.lanes ?? [];
  const all = lanes.flatMap((l) => l.tasks);
  const total = weighted(all.map((t) => ({ progress: t.progress, hours: t.estimateHours })));

  const setLocal = (id: string, patch: Partial<Card>, toLane?: string | null) => {
    if (!board.data) return;
    const found = board.data.lanes.flatMap((l) => l.tasks).find((t) => t.id === id);
    if (!found) return;
    const card: Card = { ...found, ...patch };
    const next = board.data.lanes.map((l) => {
      const has = l.tasks.some((t) => t.id === id);
      let tasks = l.tasks;
      if (toLane === undefined) tasks = tasks.map((t) => (t.id === id ? card : t));
      else if (has && l.id !== toLane) tasks = tasks.filter((t) => t.id !== id);
      else if (l.id === toLane) tasks = has ? tasks.map((t) => (t.id === id ? card : t)) : [...tasks, card];
      return { ...l, tasks, progress: weighted(tasks.map((t) => ({ progress: t.progress, hours: t.estimateHours }))) };
    });
    board.setData({ ...board.data, lanes: next });
  };

  const update = async (t: Card, progress: number, laneId?: string | null) => {
    const p = Math.max(0, Math.min(100, progress));
    setLocal(t.id, { progress: p }, laneId);
    try {
      await api.patch(`/projects/${proj.id}/tasks/${t.id}`, { progress: p, ...(laneId !== undefined ? { laneId } : {}) });
      reloadProject();
    } catch (e) {
      toast.show((e as Error).message, true);
      board.reload();
    }
  };

  const onDrop = (e: DragEvent, laneId: string | null, col: (typeof COLS)[number]) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/plain') || dragId;
    setDragId(null);
    const card = all.find((t) => t.id === id);
    if (!card) return;
    const fromLane = lanes.find((l) => l.tasks.some((t) => t.id === id))?.id ?? null;
    const newP = col.test(card.progress) ? card.progress : col.drop(card.progress);
    if (newP === card.progress && fromLane === laneId) return;
    update(card, newP, fromLane !== laneId ? laneId : undefined);
  };

  return (
    <>
      <Topbar crumbs={[{ label: me.tenant!.role === 'MEMBER' ? 'Projects' : 'Portfolio', href: base }, { label: proj.name, href: pb }, { label: 'Swim lanes' }]} />
      <div className="page">
        <div className="page-head">
          <div className="col gap4 grow">
            <h1 className="page-title">Swim lanes</h1>
            <p className="small muted">{can.work ? 'Drag cards between columns or lanes, or use the buttons on a card. Lane totals update straight away.' : 'Read-only view.'}</p>
          </div>
          <span className="row gap8 card" style={{ padding: '8px 14px', alignItems: 'baseline' }}>
            <span className="small muted">All lanes</span><span className="display" style={{ fontSize: 22, fontWeight: 700 }}>{pct(total)}</span>
          </span>
          {can.plan && <button className="btn" onClick={() => setLaneEdit('new')}>+ Add lane</button>}
          {can.work && <button className="btn primary" onClick={() => setAddingIn(lanes[0]?.id ?? null)}><I.Plus size={14} />Add task</button>}
        </div>

        {board.error && <ErrorBox error={board.error} retry={board.reload} />}
        {!board.data && !board.error && <Loading />}
        {board.data && lanes.length === 0 && (
          <div className="card"><Empty title="No swim lanes yet" action={can.plan ? <button className="btn primary" onClick={() => setLaneEdit('new')}>Add the first lane</button> : undefined}>
            Swim lanes are workstreams — Finance, Warehouse, Training… Every task belongs to one, and the lane shows how far along that workstream is.
          </Empty></div>
        )}

        {lanes.length > 0 && <div className="lane-head" aria-hidden="true"><span>Lane</span>{COLS.map((c) => <span key={c.key}>{c.label}</span>)}</div>}

        {lanes.map((l) => (
          <section key={l.id ?? 'none'} className="lane" aria-label={l.name}>
            <div className="col gap8" style={{ padding: '6px 8px' }}>
              <span className="row gap8 strong" style={{ fontSize: 15 }}>
                <span className="dot" style={{ background: l.color, borderRadius: 3, width: 10, height: 10 }} />
                <span className="grow ellipsis">{l.name}</span>
                {can.plan && l.id && <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label={`Edit lane ${l.name}`} onClick={() => setLaneEdit(l)}><I.Pencil size={14} /></button>}
              </span>
              <span className="tiny muted">{l.leadName ? `Lead: ${l.leadName} · ` : ''}{Math.round(l.hours)} h · {l.tasks.length} task{l.tasks.length === 1 ? '' : 's'}</span>
              <span className="row gap6" style={{ alignItems: 'baseline', marginTop: 4 }}>
                <span className="display" style={{ fontSize: 26, fontWeight: 700 }}>{pct(l.progress)}</span>
                <span className="tiny muted">done · plan {pct(l.planned)}</span>
              </span>
              <Bar value={l.progress} mark={l.planned} color={l.color} />
              {l.budgetPosts.length > 0 && <span className="tiny muted">Budget: {l.budgetPosts.join(', ')}</span>}
              {can.work && <button className="btn ghost sm" style={{ justifyContent: 'flex-start', padding: '0 4px' }} onClick={() => setAddingIn(l.id)}>+ Task in this lane</button>}
            </div>
            {COLS.map((c) => {
              const key = `${l.id}:${c.key}`;
              return (
                <div key={c.key} className={`lane-col ${over === key ? 'drop' : ''}`} data-label={c.label}
                  onDragOver={(e) => { if (can.work) { e.preventDefault(); setOver(key); } }}
                  onDragLeave={() => setOver((o) => (o === key ? null : o))}
                  onDrop={(e) => can.work && onDrop(e, l.id, c)}>
                  {l.tasks.filter((t) => c.test(t.progress)).map((t) => (
                    <article key={t.id} className={`tcard ${dragId === t.id ? 'dragging' : ''}`} draggable={can.work}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id); }}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                      style={{ cursor: can.work ? 'grab' : 'default' }}>
                      <div className="row top gap8">
                        <Link href={`${pb}/tasks/${t.id}`} className="grow strong" style={{ fontSize: 14, lineHeight: 1.35, textDecoration: 'none', fontWeight: 500 }}>{t.title}</Link>
                        {t.guest ? <Avatar name={t.guest.name} guest small /> : t.assignee ? <Avatar name={t.assignee.name} small /> : null}
                      </div>
                      <div className="row gap8"><span className="grow"><Bar value={t.progress} size="thin" /></span><span className="mono tiny" style={{ width: 36, textAlign: 'right' }}>{t.progress}%</span></div>
                      <div className="row gap6">
                        <span className={`tiny grow ${t.late ? 'txt-bad strong' : 'muted'}`}>{t.dueDate ? (t.late ? `Overdue · ${shortDate(t.dueDate)}` : `Due ${shortDate(t.dueDate)}`) : 'No due date'}</span>
                        {can.work && (
                          <>
                            <button className="btn sm" style={{ minWidth: 44, padding: '0 8px', minHeight: 28 }} aria-label={`Lower progress on ${t.title} by 25%`} disabled={t.progress === 0} onClick={() => update(t, t.progress - 25)}>−25%</button>
                            <button className="btn primary sm" style={{ minWidth: 44, padding: '0 8px', minHeight: 28 }} aria-label={`Raise progress on ${t.title} by 25%`} disabled={t.progress === 100} onClick={() => update(t, t.progress + 25)}>+25%</button>
                          </>
                        )}
                      </div>
                      {t.guest && <span className="tiny muted">Shared with {t.guest.name}{t.guest.org ? `, ${t.guest.org}` : ''}</span>}
                    </article>
                  ))}
                </div>
              );
            })}
          </section>
        ))}
        {lanes.length > 0 && <p className="tiny muted">Lane progress = sum of (task progress × estimated hours) ÷ lane hours. A dashed avatar means the task is shared with someone outside through a task link.</p>}
      </div>

      {addingIn !== undefined && <NewTaskModal laneId={addingIn} onClose={() => setAddingIn(undefined)} onCreated={() => { setAddingIn(undefined); board.reload(); reloadProject(); }} />}
      {laneEdit && <LaneDialog lane={laneEdit === 'new' ? null : laneEdit} onClose={() => setLaneEdit(null)} onSaved={() => { setLaneEdit(null); board.reload(); reloadProject(); }} />}
    </>
  );
}

const PALETTE = ['#2F5BD3', '#0F6B5C', '#A3201C', '#8A4306', '#6B3FA0', '#1F6F8B', '#5C5F67'];

function LaneDialog({ lane, onClose, onSaved }: { lane: Lane | null; onClose: () => void; onSaved: () => void }) {
  const { data: proj } = useProject();
  const members = useApi<any>(`/projects/${proj.id}/members`);
  const current = lane ? proj.lanes.find((l: any) => l.id === lane.id) : null;
  const [name, setName] = useState(lane?.name ?? '');
  const [color, setColor] = useState(lane?.color ?? PALETTE[proj.lanes.length % PALETTE.length]);
  const [lead, setLead] = useState<string>(current?.leadAccountId ?? '');
  const [confirmDel, setConfirmDel] = useState(false);
  const { busy, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name, color, leadAccountId: lead || null };
    const r = await run(() => (lane ? api.patch(`/projects/${proj.id}/lanes/${lane.id}`, body) : api.post(`/projects/${proj.id}/lanes`, body)), lane ? 'Lane saved' : 'Lane added');
    if (r) onSaved();
  };
  return (
    <Modal title={lane ? 'Edit swim lane' : 'Add swim lane'} narrow onClose={onClose}
      footer={<>
        {lane && <button className="btn ghost" style={{ marginRight: 'auto', color: 'var(--red)' }} onClick={() => setConfirmDel(true)}>Delete lane</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" form="lane" disabled={busy}>{lane ? 'Save' : 'Add lane'}</button>
      </>}>
      <form id="lane" className="col gap14" onSubmit={submit}>
        <label className="field">Name<input className="input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Data migration" /></label>
        <fieldset className="col gap8" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small strong" style={{ marginBottom: 6 }}>Color</legend>
          <div className="row gap8">
            {PALETTE.map((c) => (
              <button type="button" key={c} aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}
                style={{ width: 32, height: 32, borderRadius: 8, background: c, border: color === c ? '3px solid var(--ink)' : '3px solid transparent', outline: color === c ? '2px solid #fff' : undefined, outlineOffset: -5, cursor: 'pointer' }} />
            ))}
          </div>
        </fieldset>
        <label className="field">Lead
          <select className="select" value={lead} onChange={(e) => setLead(e.target.value)}>
            <option value="">No lead</option>
            {(members.data?.members ?? []).map((m: any) => <option key={m.accountId} value={m.accountId}>{m.name}</option>)}
          </select>
        </label>
      </form>
      {confirmDel && lane && (
        <Confirm title={`Delete ${lane.name}?`} text="Its tasks are kept and moved to “No lane”." confirmLabel="Delete lane" danger
          onConfirm={() => run(() => api.del(`/projects/${proj.id}/lanes/${lane.id}`), 'Lane deleted').then(onSaved)} onClose={() => setConfirmDel(false)} />
      )}
    </Modal>
  );
}
