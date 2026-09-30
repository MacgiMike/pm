'use client';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { useProject } from '@/lib/context';
import { useApi } from '@/lib/useApi';
import { Modal, useAction } from './ui';

export function NewTaskModal({ onClose, onCreated, laneId }: { onClose: () => void; onCreated: (id: string) => void; laneId?: string | null }) {
  const { data: d } = useProject();
  const members = useApi<any>(`/projects/${d.id}/members`);
  const budget = useApi<any>(d.can.budgetEdit ? `/projects/${d.id}/budget` : null);
  const { busy, run } = useAction();
  const [f, setF] = useState({
    title: '', laneId: laneId ?? d.lanes[0]?.id ?? '', assigneeAccountId: '', startDate: '', dueDate: '', estimateHours: '', tollgateId: '', budgetPostId: '', description: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      title: f.title,
      description: f.description || undefined,
      laneId: f.laneId || null,
      assigneeAccountId: f.assigneeAccountId || null,
      startDate: f.startDate || null,
      dueDate: f.dueDate || null,
      estimateHours: f.estimateHours ? Number(f.estimateHours.replace(',', '.')) : null,
      tollgateId: f.tollgateId || null,
    };
    if (d.can.budgetEdit && f.budgetPostId) body.budgetPostId = f.budgetPostId;
    const r = await run(() => api.post(`/projects/${d.id}/tasks`, body), 'Task added');
    if (r) onCreated(r.id);
  };
  return (
    <Modal title="Add task" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="nt" disabled={busy}>Add task</button></>}>
      <form id="nt" className="col gap14" onSubmit={submit}>
        <label className="field">What needs to be done?<input className="input" required autoFocus value={f.title} onChange={set('title')} placeholder="e.g. Configure invoice approval flow" /></label>
        <div className="grid g2">
          <label className="field">Swim lane
            <select className="select" value={f.laneId} onChange={set('laneId')}>
              <option value="">No lane</option>
              {d.lanes.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="field">Responsible
            <select className="select" value={f.assigneeAccountId} onChange={set('assigneeAccountId')}>
              <option value="">Nobody yet</option>
              {(members.data?.members ?? []).map((m: any) => <option key={m.accountId} value={m.accountId}>{m.name}</option>)}
            </select>
          </label>
        </div>
        <div className="grid g3">
          <label className="field">Start<input className="input" type="date" value={f.startDate} onChange={set('startDate')} /></label>
          <label className="field">Due<input className="input" type="date" value={f.dueDate} onChange={set('dueDate')} /></label>
          <label className="field">Estimate (hours)<input className="input" inputMode="decimal" value={f.estimateHours} onChange={set('estimateHours')} placeholder="e.g. 40" /></label>
        </div>
        <div className="grid g2">
          <label className="field">Must finish before
            <select className="select" value={f.tollgateId} onChange={set('tollgateId')}>
              <option value="">No tollgate</option>
              {d.tollgates.map((g: any) => <option key={g.id} value={g.id}>{g.code} {g.name}</option>)}
            </select>
          </label>
          {d.can.budgetEdit && (
            <label className="field">Budget post
              <select className="select" value={f.budgetPostId} onChange={set('budgetPostId')}>
                <option value="">None</option>
                {(budget.data?.posts ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="field">Description (optional)<textarea className="textarea" rows={3} value={f.description} onChange={set('description')} /></label>
        <p className="tiny muted">The estimate decides how much this task weighs in its swim lane’s progress. No estimate counts as 1 hour.</p>
      </form>
    </Modal>
  );
}
