'use client';
import { useParams, useRouter } from 'next/navigation';
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useProject, useTenant } from '@/lib/context';
import { fileSize, shortDate, timeAgo, weighted } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { I } from '@/components/icons';
import { Topbar } from '@/components/shell';
import { Avatar, Confirm, ErrorBox, InlineText, Loading, Modal, useAction, useToast } from '@/components/ui';

export default function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { me, base } = useTenant();
  const { data: proj, base: pb, reload: reloadProject } = useProject();
  const t = useApi<any>(`/projects/${proj.id}/tasks/${taskId}`);
  const members = useApi<any>(`/projects/${proj.id}/members`);
  const budget = useApi<any>(proj.can.budgetEdit ? `/projects/${proj.id}/budget` : null);
  const { busy, run } = useAction();
  const router = useRouter();
  const [p, setP] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (t.data) setP(t.data.progress); }, [t.data]);

  if (t.error) return <div className="page"><ErrorBox error={t.error} retry={t.reload} /></div>;
  if (!t.data || p === null) return <Loading />;
  const d = t.data;
  const can = d.can;

  const patch = async (body: Record<string, unknown>, msg?: string) => {
    const r = await run(() => api.patch(`/projects/${proj.id}/tasks/${d.id}`, body), msg);
    await t.reload();
    reloadProject();
    return r;
  };
  const commitProgress = (v: number) => {
    if (v === d.progress) return;
    patch({ progress: v }, v === 100 ? 'Marked as done' : undefined);
  };

  const laneP = d.lane ? weighted([...d.rollup.laneOther, { progress: p, hours: d.estimateHours }]) : null;
  const projP = weighted([...d.rollup.projectOther, { progress: p, hours: d.estimateHours }]);
  const done = p === 100;

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const form = new FormData();
    form.append('file', f);
    await run(() => api.upload(`/projects/${proj.id}/tasks/${d.id}/files`, form), 'File attached');
    t.reload();
  };
  const sendComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    const r = await run(() => api.post(`/projects/${proj.id}/tasks/${d.id}/comments`, { text: comment }));
    if (r) { setComment(''); t.reload(); }
  };

  return (
    <>
      <Topbar crumbs={[
        { label: me.tenant!.role === 'MEMBER' ? 'Projects' : 'Portfolio', href: base },
        { label: proj.name, href: pb },
        ...(d.lane ? [{ label: d.lane.name, href: `${pb}/lanes` }] : []),
        { label: d.title },
      ]} />
      <div className="page">
        <div className="grid aside-right" style={{ gridTemplateColumns: 'minmax(0,1fr) 400px' }}>
          <div className="col gap16">
            <div className="col gap8">
              <div className="row top gap8">
                <div className="grow">
                  {can.work ? (
                    <InlineText ariaLabel="Task title" value={d.title} className="display" onSave={(v) => patch({ title: v })}
                      placeholder="Task title" />
                  ) : <h1 className="page-title" style={{ fontSize: 26 }}>{d.title}</h1>}
                </div>
                <span className={`badge ${done ? 'ok' : d.late ? 'bad' : p > 0 ? 'info' : 'neutral'}`} style={{ marginTop: 9 }}>
                  {done ? 'Done' : d.late ? `Overdue since ${shortDate(d.dueDate)}` : p > 0 ? 'In progress' : 'Not started'}
                </span>
              </div>
              {can.work
                ? <InlineText ariaLabel="Description" multiline value={d.description} onSave={(v) => patch({ description: v })} placeholder="Describe what needs to be done…" />
                : d.description && <p style={{ color: 'var(--text2)', lineHeight: 1.5 }}>{d.description}</p>}
            </div>

            <section className="card pad col gap14">
              <div className="row" style={{ alignItems: 'baseline' }}><h2 className="grow" style={{ fontSize: 16, fontWeight: 600 }}>Progress</h2><span className="display" style={{ fontSize: 30, fontWeight: 700 }}>{p}%</span></div>
              <input type="range" min={0} max={100} step={5} value={p} disabled={!can.work} aria-label="Task progress"
                onChange={(e) => setP(Number(e.target.value))}
                onPointerUp={(e) => commitProgress(Number((e.target as HTMLInputElement).value))}
                onKeyUp={(e) => commitProgress(Number((e.target as HTMLInputElement).value))}
                style={{ width: '100%', accentColor: 'var(--ink)', height: 28 }} />
              {can.work && (
                <div className="row gap8">
                  {[0, 25, 50, 75, 100].map((v) => (
                    <button key={v} className={`btn sm grow ${p === v ? 'primary' : ''}`} style={{ flex: 1 }} onClick={() => { setP(v); commitProgress(v); }} disabled={busy}>{v === 100 ? 'Done' : `${v}%`}</button>
                  ))}
                </div>
              )}
              <div className="note row small" style={{ gap: 10 }}>
                <I.Lanes />
                <span>{d.lane ? <>Lane <strong>{d.lane.name}</strong> {p !== d.progress ? 'becomes' : 'is at'} <strong>{Math.round(laneP!)}%</strong> · </> : null}project {p !== d.progress ? 'becomes' : 'is at'} <strong>{Math.round(projP)}%</strong></span>
              </div>
            </section>

            <section className="card pad grid g3" style={{ gap: '16px 20px' }}>
              <label className="field">Swim lane
                <select className="select" disabled={!can.work} value={d.lane?.id ?? ''} onChange={(e) => patch({ laneId: e.target.value || null })}>
                  <option value="">No lane</option>
                  {proj.lanes.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <label className="field">Responsible
                <select className="select" disabled={!can.work} value={d.assignee?.id ?? ''} onChange={(e) => patch({ assigneeAccountId: e.target.value || null })}>
                  <option value="">Nobody yet</option>
                  {(members.data?.members ?? []).map((m: any) => <option key={m.accountId} value={m.accountId}>{m.name}</option>)}
                </select>
              </label>
              <label className="field">Must finish before
                <select className="select" disabled={!can.work} value={d.tollgate?.id ?? ''} onChange={(e) => patch({ tollgateId: e.target.value || null })}>
                  <option value="">No tollgate</option>
                  {proj.tollgates.map((g: any) => <option key={g.id} value={g.id}>{g.code} {g.name} · {shortDate(g.date)}</option>)}
                </select>
              </label>
              <label className="field">Start
                <input className="input" type="date" disabled={!can.work} defaultValue={d.startDate ?? ''} key={`s${d.startDate}`} onBlur={(e) => (e.target.value || null) !== d.startDate && patch({ startDate: e.target.value || null })} />
              </label>
              <label className="field">Due
                <input className="input" type="date" disabled={!can.work} defaultValue={d.dueDate ?? ''} key={`d${d.dueDate}`} style={d.late ? { borderColor: 'var(--red)' } : undefined}
                  onBlur={(e) => (e.target.value || null) !== d.dueDate && patch({ dueDate: e.target.value || null })} />
              </label>
              <label className="field">Estimate (hours)
                <InlineText ariaLabel="Estimate in hours" disabled={!can.work} value={d.estimateHours == null ? '' : String(d.estimateHours)} placeholder="e.g. 40"
                  onSave={(v) => patch({ estimateHours: v.trim() ? Number(v.replace(',', '.')) : null })} />
              </label>
              {proj.can.budgetView && (
                <label className="field">Budget post
                  <select className="select" disabled={!proj.can.budgetEdit} value={d.budgetPost?.id ?? ''} onChange={(e) => patch({ budgetPostId: e.target.value || null })}>
                    <option value="">None</option>
                    {d.budgetPost && !(budget.data?.posts ?? []).some((x: any) => x.id === d.budgetPost.id) && <option value={d.budgetPost.id}>{d.budgetPost.name}</option>}
                    {(budget.data?.posts ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
              )}
            </section>

            <section className="card pad col gap14">
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>Activity</h2>
              {can.work && (
                <form className="row gap8" onSubmit={sendComment}>
                  <input className="input grow" placeholder="Write a comment…" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Write a comment" />
                  <button className="btn" disabled={busy || !comment.trim()}>Comment</button>
                </form>
              )}
              {d.activity.length === 0 && <p className="small muted">No activity yet.</p>}
              {d.activity.map((a: any) => (
                <div key={a.id} className="row top small" style={{ gap: 12 }}>
                  <Avatar name={a.actorName} guest={a.viaTaskLink} small />
                  <span className="col" style={{ gap: 2 }}>
                    <span><strong>{a.actorName}</strong>{a.viaTaskLink ? ' (via task link)' : ''} {a.kind === 'comment' ? 'commented' : a.text}</span>
                    {a.kind === 'comment' && <span style={{ color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>“{a.text}”</span>}
                    {a.kind === 'task.progress' && a.data?.note && <span style={{ color: 'var(--text2)' }}>“{a.data.note}”</span>}
                    <span className="tiny muted">{timeAgo(a.createdAt)}</span>
                  </span>
                </div>
              ))}
            </section>

            {(can.plan || can.work) && (
              <div className="row no-print" style={{ justifyContent: 'flex-end' }}>
                <button className="btn ghost sm" style={{ color: 'var(--red)' }} onClick={() => setDeleting(true)}><I.Trash size={14} />Delete task</button>
              </div>
            )}
          </div>

          <aside className="col gap16">
            <SharePanel task={d} onChanged={t.reload} />

            <section className="card pad col gap8">
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>Checklist</h2>
              <Checklist task={d} onChanged={t.reload} />
            </section>

            <section className="card pad col gap8">
              <div className="row"><h2 className="grow" style={{ fontSize: 16, fontWeight: 600 }}>Files</h2>
                {can.work && <><button className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy}><I.Upload size={14} />Attach</button><input ref={fileRef} type="file" hidden onChange={upload} /></>}
              </div>
              {d.files.length === 0 && <p className="small muted">No files yet.</p>}
              {d.files.map((f: any) => (
                <div key={f.id} className="row small" style={{ gap: 8 }}>
                  <I.File />
                  <a href={`/api/projects/${proj.id}/files/${f.id}`} className="grow ellipsis">{f.name}</a>
                  <span className="tiny muted nowrap">{fileSize(f.size)} · {f.uploadedByName}</span>
                </div>
              ))}
            </section>
          </aside>
        </div>
      </div>
      {deleting && (
        <Confirm title="Delete this task?" text="Its checklist, comments and files are deleted too. Task links stop working." confirmLabel="Delete task" danger
          onConfirm={async () => { const r = await run(() => api.del(`/projects/${proj.id}/tasks/${d.id}`), 'Task deleted'); if (r) { reloadProject(); router.push(`${pb}/lanes`); } }}
          onClose={() => setDeleting(false)} />
      )}
    </>
  );
}

function Checklist({ task, onChanged }: { task: any; onChanged: () => void }) {
  const { data: proj } = useProject();
  const [v, setV] = useState('');
  const { run } = useAction();
  const can = task.can.work;
  return (
    <>
      {task.checklist.length === 0 && !can && <p className="small muted">No checklist.</p>}
      {task.checklist.map((c: any) => (
        <div key={c.id} className="row gap8">
          <label className="check grow">
            <input type="checkbox" checked={c.done} disabled={!can} onChange={(e) => run(() => api.patch(`/projects/${proj.id}/checklist/${c.id}`, { done: e.target.checked })).then(onChanged)} />
            <span style={{ textDecoration: c.done ? 'line-through' : undefined, color: c.done ? 'var(--muted)' : undefined }}>{c.text}</span>
          </label>
          {can && <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label={`Remove ${c.text}`} onClick={() => run(() => api.del(`/projects/${proj.id}/checklist/${c.id}`)).then(onChanged)}><I.X size={14} /></button>}
        </div>
      ))}
      {can && (
        <form className="row gap8" onSubmit={(e) => { e.preventDefault(); if (v.trim()) run(() => api.post(`/projects/${proj.id}/tasks/${task.id}/checklist`, { text: v })).then(() => { setV(''); onChanged(); }); }}>
          <input className="input sm grow" placeholder="Add an item" value={v} onChange={(e) => setV(e.target.value)} aria-label="New checklist item" />
          <button className="btn sm">Add</button>
        </form>
      )}
    </>
  );
}

function SharePanel({ task, onChanged }: { task: any; onChanged: () => void }) {
  const { data: proj } = useProject();
  const [creating, setCreating] = useState(false);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<any>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const active = task.links.filter((l: any) => l.active);

  if (!task.can.links) {
    return (
      <section className="card pad col gap8">
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Shared with someone outside</h2>
        {active.length ? active.map((l: any) => (
          <p key={l.id} className="small" style={{ color: 'var(--text2)', lineHeight: 1.5 }}>{l.guestName}{l.guestOrg ? ` (${l.guestOrg})` : ''} can update this task through a private link.</p>
        )) : <p className="small muted">Not shared.</p>}
        <p className="tiny muted">Only the owner or a co-lead can create or revoke task links.</p>
      </section>
    );
  }

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.show('Link copied'); } catch { toast.show('Copy the link from the box', true); }
  };

  return (
    <section className="card pad col gap14">
      <div className="col gap4">
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Share with someone outside</h2>
        <p className="small muted" style={{ lineHeight: 1.5 }}>They get a private link to this task only. No account, no access to anything else in the project.</p>
      </div>
      {freshUrl && (
        <div className="note ok col gap8">
          <span className="small strong">Link emailed. You can also copy it now — for security it won’t be shown again.</span>
          <div className="row gap6">
            <input className="input sm mono" readOnly value={freshUrl} onFocus={(e) => e.target.select()} aria-label="Task link" style={{ fontSize: 12 }} />
            <button className="btn sm" onClick={() => copy(freshUrl)}>Copy</button>
          </div>
        </div>
      )}
      {active.map((l: any) => (
        <div key={l.id} className="col gap8" style={{ paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
          <div className="row gap8">
            <Avatar name={l.guestName} guest />
            <span className="col grow" style={{ gap: 1 }}>
              <strong className="small">{l.guestName}</strong>
              <span className="tiny muted">{l.guestOrg ? `${l.guestOrg} · ` : ''}{l.lastUsedAt ? `last used ${timeAgo(l.lastUsedAt)}` : 'not opened yet'}</span>
            </span>
          </div>
          <span className="tiny" style={{ color: 'var(--text2)' }}>
            Can update progress{l.canComment ? ', comment' : ''}{l.canFiles ? ', attach files' : ''} · {l.untilDone ? `until the task is done (latest ${shortDate(l.expiresAt)})` : `until ${shortDate(l.expiresAt)}`}
          </span>
          <div className="row gap8">
            <button className="btn sm grow" disabled={busy} onClick={async () => { const r = await run(() => api.post(`/projects/${proj.id}/links/${l.id}/resend`), 'A new link was emailed. The old one no longer works.'); if (r) setFreshUrl(r.url); }}>Send new link</button>
            <button className="btn danger sm grow" onClick={() => setRevoking(l)}>Revoke</button>
          </div>
        </div>
      ))}
      <button className={`btn ${active.length ? '' : 'primary'}`} onClick={() => setCreating(true)}><I.Link size={14} />{active.length ? 'Share with someone else' : 'Share this task'}</button>
      {creating && <CreateLink task={task} onClose={() => setCreating(false)} onCreated={(url) => { setCreating(false); setFreshUrl(url); onChanged(); }} />}
      {revoking && (
        <Confirm title={`Stop sharing with ${revoking.guestName}?`} text="The link stops working immediately. Their earlier updates stay on the task." confirmLabel="Revoke link" danger
          onConfirm={() => run(() => api.del(`/projects/${proj.id}/links/${revoking.id}`), 'Link revoked').then(onChanged)} onClose={() => setRevoking(null)} />
      )}
    </section>
  );
}

function CreateLink({ task, onClose, onCreated }: { task: any; onClose: () => void; onCreated: (url: string) => void }) {
  const { data: proj } = useProject();
  const { busy, run } = useAction();
  const [f, setF] = useState({ guestName: '', guestEmail: '', guestOrg: '', canComment: true, canFiles: true, lifetime: 'done' as 'done' | '30' | '7' });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post(`/projects/${proj.id}/tasks/${task.id}/links`, {
      guestName: f.guestName, guestEmail: f.guestEmail, guestOrg: f.guestOrg, canComment: f.canComment, canFiles: f.canFiles,
      untilDone: f.lifetime === 'done', days: f.lifetime === 'done' ? 90 : Number(f.lifetime),
    }));
    if (r) onCreated(r.url);
  };
  return (
    <Modal title="Share this task" subtitle={`“${task.title}” — nothing else in the project.`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="cl" disabled={busy}>Email the link</button></>}>
      <form id="cl" className="col gap14" onSubmit={submit}>
        <div className="grid g2">
          <label className="field">Name<input className="input" required autoFocus value={f.guestName} onChange={(e) => setF({ ...f, guestName: e.target.value })} /></label>
          <label className="field">Email<input className="input" type="email" required value={f.guestEmail} onChange={(e) => setF({ ...f, guestEmail: e.target.value })} /></label>
        </div>
        <label className="field">Company (optional)<input className="input" value={f.guestOrg} onChange={(e) => setF({ ...f, guestOrg: e.target.value })} /></label>
        <fieldset className="col gap8" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small strong" style={{ marginBottom: 6 }}>They can</legend>
          <label className="check"><input type="checkbox" checked disabled />Update progress</label>
          <label className="check"><input type="checkbox" checked={f.canComment} onChange={(e) => setF({ ...f, canComment: e.target.checked })} />Write comments</label>
          <label className="check"><input type="checkbox" checked={f.canFiles} onChange={(e) => setF({ ...f, canFiles: e.target.checked })} />Attach files and photos</label>
        </fieldset>
        <label className="field">Link works until
          <select className="select" value={f.lifetime} onChange={(e) => setF({ ...f, lifetime: e.target.value as any })}>
            <option value="done">The task is done (max 90 days)</option>
            <option value="30">30 days</option>
            <option value="7">7 days</option>
          </select>
        </label>
      </form>
    </Modal>
  );
}
