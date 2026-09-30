'use client';
import { FormEvent, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useProject, useTenant } from '@/lib/context';
import { money, pct, shortDate, todayYmd } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { I } from '@/components/icons';
import { AllocationNote, PostsEditor } from '@/components/project';
import { Topbar } from '@/components/shell';
import { Bar, Confirm, download, Empty, ErrorBox, Loading, Modal, MoneyInput, useAction } from '@/components/ui';

export default function BudgetPage() {
  const { me, base } = useTenant();
  const { data: proj, base: pb, reload: reloadProject } = useProject();
  const b = useApi<any>(proj.can.budgetView ? `/projects/${proj.id}/budget` : null);
  const [booking, setBooking] = useState(false);
  const [linking, setLinking] = useState<any>(null);
  const [editingPosts, setEditingPosts] = useState(false);
  const [deleting, setDeleting] = useState<any>(null);
  const { run } = useAction();
  const currency = me.tenant!.currency;
  const edit = proj.can.budgetEdit;
  const refresh = () => { b.reload(); reloadProject(); };

  if (!proj.can.budgetView) {
    return <div className="page"><div className="card pad">Budget is visible to the project owner and co-leads.</div></div>;
  }

  return (
    <>
      <Topbar crumbs={[{ label: me.tenant!.role === 'MEMBER' ? 'Projects' : 'Portfolio', href: base }, { label: proj.name, href: pb }, { label: 'Budget & costs' }]} />
      <div className="page">
        <div className="page-head">
          <h1 className="page-title grow">Budget &amp; costs</h1>
          <button className="btn" onClick={() => download(`/projects/${proj.id}/costs.csv`)}><I.Download />Excel (CSV)</button>
          {edit && <button className="btn primary" onClick={() => setBooking(true)} disabled={!b.data?.posts.length}><I.FilePlus />Book an invoice</button>}
        </div>
        {b.error && <ErrorBox error={b.error} retry={b.reload} />}
        {!b.data && !b.error && <Loading />}
        {b.data && (() => {
          const T = b.data.totals;
          const spentPct = T.total ? (T.spent / T.total) * 100 : 0;
          return (
            <>
              <div className="grid g4">
                <div className="card pad stat">
                  <span className="stat-label">Approved budget</span>
                  {edit ? (
                    <MoneyInput ariaLabel="Approved budget" value={T.approved} currency={currency}
                      onSave={(v) => api.patch(`/projects/${proj.id}`, { approvedBudget: v }).then(refresh)} />
                  ) : <span className="stat-value money">{money(T.approved, currency)}</span>}
                  {!T.approved && <span className="tiny muted">Not set — the posts’ total ({money(T.allocated, currency)}) is used</span>}
                </div>
                <div className="card pad stat"><span className="stat-label">Spent so far</span><span className="stat-value money">{money(T.spent, currency)}</span><span className="tiny muted">{pct(spentPct)} of budget · work is {pct(T.progress)} done</span></div>
                <div className="card pad stat"><span className="stat-label">Left to spend</span><span className={`stat-value money ${T.left < 0 ? 'txt-bad' : ''}`}>{money(T.left, currency)}</span></div>
                <div className="card pad stat">
                  <span className="stat-label">Forecast at finish</span>
                  <span className={`stat-value money ${T.forecast > T.total && T.total ? 'txt-warn' : ''}`}>{money(T.forecast, currency)}</span>
                  <span className={`tiny ${T.forecast > T.total && T.total ? 'txt-warn strong' : 'muted'}`}>
                    {T.total ? (T.forecast > T.total ? `${money(T.forecast - T.total, currency)} over` : `${money(T.total - T.forecast, currency)} under`) : '—'}
                  </span>
                </div>
              </div>

              <section className="card" aria-label="Budget posts">
                <div className="card-head">
                  <h2>Budget posts</h2>
                  {edit && <button className="btn sm" onClick={() => setEditingPosts(true)}>Edit posts</button>}
                </div>
                {b.data.posts.length === 0 ? (
                  <Empty title="No budget posts yet" action={edit ? <button className="btn primary" onClick={() => setEditingPosts(true)}>Add posts</button> : undefined}>
                    Split the budget into posts like “External consultants” or “Licenses”. Then connect each post to the lanes or tasks it pays for.
                  </Empty>
                ) : (
                  <div className="scroll-x">
                    <div className="table">
                      <div className="trow thead" style={{ gridTemplateColumns: PCOLS }}><span>Budget post</span><span>Pays for</span><span className="right">Budget</span><span className="right">Spent</span><span className="right">Left</span><span>Used vs work done</span></div>
                      {b.data.posts.map((p: any) => {
                        const burning = p.pct > p.workProgress + 15 && p.pct >= 50;
                        return (
                          <div key={p.id} className="trow" style={{ gridTemplateColumns: PCOLS }}>
                            <span className="strong">{p.name}</span>
                            <span className="row wrap gap6">
                              {p.links.length === 0 ? <span className="tag">Whole project</span> : p.links.map((l: any) => <span key={`${l.type}${l.id}`} className="tag">{l.type === 'lane' ? 'Lane' : 'Task'} · {l.name}</span>)}
                              {edit && <button className="btn ghost sm" style={{ minHeight: 28 }} onClick={() => setLinking(p)}>Change</button>}
                            </span>
                            <span className="right mono small">{money(p.amount, currency)}</span>
                            <span className="right mono small">{money(p.spent, currency)}</span>
                            <span className={`right mono small ${p.left < 0 ? 'txt-bad' : ''}`}>{money(p.left, currency)}</span>
                            <span className="col gap4">
                              <span className="row gap8">
                                <span className="grow"><Bar value={Math.min(100, p.pct)} mark={p.workProgress} color={p.pct > 100 ? 'var(--red)' : p.pct >= 75 ? 'var(--amber-mid)' : undefined} /></span>
                                <span className={`tiny mono ${p.pct > 100 ? 'txt-bad strong' : p.pct >= 75 ? 'txt-warn strong' : ''}`} style={{ width: 40, textAlign: 'right' }}>{p.pct}%</span>
                              </span>
                              <span className={`tiny ${burning ? 'txt-warn strong' : 'muted'}`}>{burning ? `Spending faster than the work (${pct(p.workProgress)} done)` : `Work ${pct(p.workProgress)} done`}</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {b.data.posts.length > 0 && <div style={{ padding: '12px 20px' }}><AllocationNote approved={T.approved} allocated={T.allocated} currency={currency} /></div>}
              </section>

              <section className="card" aria-label="Booked costs">
                <div className="card-head"><h2>Booked invoices &amp; costs</h2><span className="small muted">{b.data.costs.length} entries</span></div>
                {b.data.costs.length === 0 ? (
                  <Empty title="No costs booked yet">When an invoice comes in — say consultant hours for a lane — book it here. It lowers what’s left on the post and shows on the task or lane it was for.</Empty>
                ) : (
                  <div className="scroll-x">
                    <div className="table">
                      <div className="trow thead" style={{ gridTemplateColumns: CCOLS }}><span>Date</span><span>Supplier</span><span>Reference</span><span>Post</span><span>For</span><span className="right">Amount</span><span /></div>
                      {b.data.costs.map((c: any) => (
                        <div key={c.id} className="trow" style={{ gridTemplateColumns: CCOLS }}>
                          <span className="small muted">{shortDate(c.date)}</span>
                          <span className="strong ellipsis">{c.supplier}</span>
                          <span className="mono tiny ellipsis" style={{ color: 'var(--text2)' }}>{c.reference || '—'}</span>
                          <span className="small ellipsis">{c.post.name}</span>
                          <span className="small ellipsis" style={{ color: 'var(--text2)' }}>{c.task ? `${c.lane?.name ? `${c.lane.name} › ` : ''}${c.task.name}` : c.lane?.name ?? 'Whole project'}</span>
                          <span className="right mono small">{money(c.amount, currency)}</span>
                          <span className="row gap4" style={{ justifyContent: 'flex-end' }}>
                            {c.file && <a className="icon-btn" href={`/api/projects/${proj.id}/files/${c.file.id}`} aria-label={`Download ${c.file.name}`} title={c.file.name}><I.Clip /></a>}
                            {edit && <button className="icon-btn" aria-label="Delete cost" onClick={() => setDeleting(c)}><I.Trash /></button>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </>
          );
        })()}
      </div>
      {booking && b.data && <BookInvoice budget={b.data} onClose={() => setBooking(false)} onBooked={() => { setBooking(false); refresh(); }} />}
      {linking && b.data && <LinkPost post={linking} budget={b.data} onClose={() => setLinking(null)} onSaved={() => { setLinking(null); refresh(); }} />}
      {editingPosts && b.data && (
        <Modal title="Budget posts" onClose={() => setEditingPosts(false)} footer={<button className="btn primary" onClick={() => setEditingPosts(false)}>Done</button>}>
          <PostsEditor projectId={proj.id} posts={b.data.posts} currency={currency} canEdit={edit} onChanged={refresh} compact />
          <AllocationNote approved={b.data.totals.approved} allocated={b.data.totals.allocated} currency={currency} />
        </Modal>
      )}
      {deleting && (
        <Confirm title="Delete this cost?" text={`${deleting.supplier} · ${money(deleting.amount, currency)}. The attached invoice file is deleted too.`} confirmLabel="Delete" danger
          onConfirm={() => run(() => api.del(`/projects/${proj.id}/costs/${deleting.id}`), 'Cost deleted').then(refresh)} onClose={() => setDeleting(null)} />
      )}
    </>
  );
}

const PCOLS = 'minmax(0,1.2fr) minmax(0,1.8fr) 120px 120px 120px minmax(180px,1.4fr)';
const CCOLS = '80px minmax(0,1.3fr) 110px minmax(0,1.1fr) minmax(0,1.8fr) 120px 72px';

function BookInvoice({ budget, onClose, onBooked }: { budget: any; onClose: () => void; onBooked: () => void }) {
  const { data: proj } = useProject();
  const { me } = useTenant();
  const currency = me.tenant!.currency;
  const { busy, run } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ supplier: '', reference: '', amount: '', date: todayYmd(), budgetPostId: budget.posts[0]?.id ?? '', target: '', note: '' });
  const amount = Number(f.amount.replace(/\s/g, '').replace(',', '.')) || 0;
  const post = budget.posts.find((p: any) => p.id === f.budgetPostId);
  const after = post ? post.spent + amount : 0;
  const afterPct = post && post.amount ? Math.round((after / post.amount) * 100) : 0;

  const onFile = (x: File | null) => {
    setFile(x);
    if (x && !f.reference) {
      const m = x.name.match(/(INV|FAKT|F)[-_ ]?\d+/i);
      if (m) setF((s) => ({ ...s, reference: m[0].toUpperCase().replace('_', '-') }));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const [kind, id] = f.target.split(':');
    const form = new FormData();
    form.append('budgetPostId', f.budgetPostId);
    form.append('supplier', f.supplier);
    form.append('reference', f.reference);
    form.append('amount', String(amount));
    form.append('date', f.date);
    form.append('note', f.note);
    if (kind === 'lane') form.append('laneId', id);
    if (kind === 'task') form.append('taskId', id);
    if (file) form.append('file', file);
    const r = await run(() => api.upload(`/projects/${proj.id}/costs`, form), `Booked ${money(amount, currency)}`);
    if (r) onBooked();
  };

  return (
    <Modal title="Book an invoice" subtitle="Record a cost against a budget post and, if you like, the lane or task it was for." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="bi" disabled={busy || !amount}>Book {amount ? money(amount, currency) : ''}</button></>}>
      <form id="bi" className="col gap14" onSubmit={submit}>
        <button type="button" onClick={() => fileRef.current?.click()} className="row"
          style={{ minHeight: 64, border: '1.5px dashed #9c9a93', borderRadius: 10, justifyContent: 'center', gap: 10, background: 'var(--surface)', cursor: 'pointer', fontSize: 14, color: 'var(--text2)' }}>
          {file ? <><I.File />{file.name} <span className="muted">· change</span></> : <><I.Upload />Attach the invoice PDF (optional)</>}
        </button>
        <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        <div className="grid g3">
          <label className="field">Supplier<input className="input" required value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} placeholder="e.g. Datakonsult AB" /></label>
          <label className="field">Invoice no.<input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
          <label className="field">Amount excl. VAT<input className="input money" required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder={currency} /></label>
        </div>
        <div className="grid g3">
          <label className="field">Budget post
            <select className="select" required value={f.budgetPostId} onChange={(e) => setF({ ...f, budgetPostId: e.target.value })}>
              {budget.posts.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">What was it for?
            <select className="select" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}>
              <option value="">Whole project</option>
              {budget.lanes.map((l: any) => (
                <optgroup key={l.id} label={l.name}>
                  <option value={`lane:${l.id}`}>{l.name} (whole lane)</option>
                  {budget.tasks.filter((t: any) => t.laneId === l.id).map((t: any) => <option key={t.id} value={`task:${t.id}`}>{l.name} › {t.title}</option>)}
                </optgroup>
              ))}
              {budget.tasks.some((t: any) => !t.laneId) && (
                <optgroup label="No lane">
                  {budget.tasks.filter((t: any) => !t.laneId).map((t: any) => <option key={t.id} value={`task:${t.id}`}>{t.title}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          <label className="field">Invoice date<input className="input" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        </div>
        <label className="field">Note (optional)<input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. September consultant hours" /></label>
        {post && amount > 0 && (
          <div className={`note ${afterPct > 100 ? 'bad' : afterPct > post.workProgress + 15 ? 'warn' : 'ok'}`}>
            After this, <strong>{post.name}</strong> will be at <strong>{afterPct}%</strong> ({money(after, currency)} of {money(post.amount, currency)}) while the work it pays for is {pct(post.workProgress)} done.
            {afterPct > 100 ? ' That’s over budget.' : afterPct > post.workProgress + 15 ? ' It’s spending faster than the work — it will show in the next status report.' : ''}
          </div>
        )}
      </form>
    </Modal>
  );
}

function LinkPost({ post, budget, onClose, onSaved }: { post: any; budget: any; onClose: () => void; onSaved: () => void }) {
  const { data: proj } = useProject();
  const { busy, run } = useAction();
  const [lanes, setLanes] = useState<string[]>(post.links.filter((l: any) => l.type === 'lane').map((l: any) => l.id));
  const [tasks, setTasks] = useState<string[]>(post.links.filter((l: any) => l.type === 'task').map((l: any) => l.id));
  const toggle = (xs: string[], set: (v: string[]) => void, id: string) => set(xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]);
  const save = async () => {
    const r = await run(() => api.put(`/projects/${proj.id}/budget/posts/${post.id}/links`, { laneIds: lanes, taskIds: tasks }), 'Saved');
    if (r) onSaved();
  };
  return (
    <Modal title={`What does “${post.name}” pay for?`} subtitle="Pick lanes and/or single tasks. Nothing picked = the whole project." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>Save</button></>}>
      <div className="col gap8">
        <span className="section-title">Swim lanes</span>
        {budget.lanes.length === 0 && <span className="small muted">No lanes yet.</span>}
        {budget.lanes.map((l: any) => <label key={l.id} className="check"><input type="checkbox" checked={lanes.includes(l.id)} onChange={() => toggle(lanes, setLanes, l.id)} />{l.name}</label>)}
      </div>
      <div className="col gap8">
        <span className="section-title">Single tasks</span>
        <div className="col gap6" style={{ maxHeight: 260, overflow: 'auto' }}>
          {budget.tasks.map((t: any) => <label key={t.id} className="check"><input type="checkbox" checked={tasks.includes(t.id)} onChange={() => toggle(tasks, setTasks, t.id)} />{t.title}</label>)}
        </div>
      </div>
    </Modal>
  );
}
