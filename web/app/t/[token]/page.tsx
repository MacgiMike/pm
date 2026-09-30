'use client';
import { useParams } from 'next/navigation';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { fileSize, shortDate, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { I } from '@/components/icons';
import { Loading, useToast } from '@/components/ui';

export default function GuestTaskPage() {
  const { token } = useParams<{ token: string }>();
  const v = useApi<any>(`/public/links/${token}`);
  const [p, setP] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (v.data && p === null) setP(v.data.task.progress); }, [v.data, p]);

  if (v.error) {
    return (
      <Frame>
        <div className="col gap14" style={{ padding: '48px 4px', textAlign: 'center', alignItems: 'center' }}>
          <span style={{ width: 56, height: 56, borderRadius: 28, background: 'var(--sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><I.Lock size={24} /></span>
          <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>This link no longer works</h1>
          <p className="muted" style={{ lineHeight: 1.5 }}>It may have expired, been replaced by a newer link, or the task may be finished. Ask the person who shared it with you for a new one.</p>
        </div>
      </Frame>
    );
  }
  if (!v.data || p === null) return <Frame><Loading /></Frame>;
  const d = v.data;

  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/public/links/${token}/update`, { progress: p, note: d.permissions.comment ? note : undefined });
      setSent(true);
      setNote('');
      v.reload();
    } catch (e) {
      toast.show(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const form = new FormData();
    form.append('file', f);
    setBusy(true);
    try {
      await api.upload(`/public/links/${token}/files`, form);
      toast.show(`${f.name} attached`);
      v.reload();
    } catch (err) {
      toast.show(errorText(err), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame org={d.tenantName} sharedBy={d.sharedBy}>
      {sent ? (
        <div role="status" className="col gap14" style={{ padding: '40px 4px', textAlign: 'center', alignItems: 'center' }}>
          <span style={{ width: 64, height: 64, borderRadius: 32, background: 'var(--green-bg)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><I.Check size={30} strokeWidth={2.5} /></span>
          <h1 className="display" style={{ fontSize: 24, fontWeight: 700 }}>Thanks, update sent</h1>
          <p style={{ color: 'var(--text2)', lineHeight: 1.5 }}>{d.sharedBy || 'The team'} can see <strong>{d.task.progress}%</strong> now. Use this link again whenever you make progress.</p>
          <button className="btn" onClick={() => setSent(false)}>Back to the task</button>
        </div>
      ) : (
        <div className="col gap14">
          <div className="col gap6">
            <span className="tiny muted">Hi {d.guestName.split(' ')[0]} — here’s your task in {d.projectName}</span>
            <h1 className="display" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>{d.task.title}</h1>
            {d.task.dueDate && <span className={`badge ${d.task.late ? 'bad' : 'neutral'}`} style={{ alignSelf: 'flex-start' }}>{d.task.late ? 'Overdue · ' : 'Due '}{shortDate(d.task.dueDate)}</span>}
          </div>
          {d.task.description && <p style={{ color: 'var(--text2)', lineHeight: 1.5 }}>{d.task.description}</p>}
          {d.task.checklist.length > 0 && (
            <div className="card pad col gap6">
              <span className="small strong">Checklist</span>
              {d.task.checklist.map((c: any, i: number) => (
                <span key={i} className="row small" style={{ gap: 8, color: c.done ? 'var(--muted)' : undefined, textDecoration: c.done ? 'line-through' : undefined }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, border: '1.5px solid var(--field)', background: c.done ? 'var(--green)' : undefined, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>{c.done && <I.Check size={11} strokeWidth={3} />}</span>
                  {c.text}
                </span>
              ))}
            </div>
          )}
          <section className="card pad col gap14" style={{ borderRadius: 14 }}>
            <div className="row" style={{ alignItems: 'baseline' }}><h2 className="grow" style={{ fontSize: 15, fontWeight: 600 }}>How far along are you?</h2><span className="display" style={{ fontSize: 26, fontWeight: 700 }}>{p}%</span></div>
            <input type="range" min={0} max={100} step={5} value={p} onChange={(e) => setP(Number(e.target.value))} aria-label="Progress" style={{ width: '100%', height: 32, accentColor: 'var(--ink)' }} />
            <div className="grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 6 }}>
              {[0, 25, 50, 75, 100].map((x) => (
                <button key={x} className={`btn ${p === x ? 'primary' : ''}`} style={{ minHeight: 44, padding: 0, fontWeight: 600 }} onClick={() => setP(x)}>{x === 100 ? 'Done' : `${x}%`}</button>
              ))}
            </div>
            {d.permissions.comment && (
              <label className="field">What changed? <span className="hint">Optional, but it helps a lot.</span>
                <textarea className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Norway addresses done, 40 left for Finland" />
              </label>
            )}
            {d.permissions.files && (
              <>
                <button className="btn" style={{ minHeight: 44, borderStyle: 'dashed' }} onClick={() => fileRef.current?.click()} disabled={busy}><I.Clip />Attach a file or photo</button>
                <input ref={fileRef} type="file" hidden onChange={upload} />
              </>
            )}
          </section>
          <button className="btn primary lg" style={{ minHeight: 52, fontSize: 16 }} onClick={save} disabled={busy}>{busy ? 'Sending…' : 'Send update'}</button>
          {(d.updates.length > 0 || d.files.length > 0) && (
            <section className="col gap8">
              <h2 className="section-title">Your earlier updates</h2>
              {d.updates.filter((u: any) => u.kind !== 'file').map((u: any) => (
                <div key={u.id} className="card small" style={{ padding: '10px 12px', lineHeight: 1.5, color: 'var(--text2)' }}>
                  <span className="muted">{timeAgo(u.createdAt)}</span> · {u.kind === 'comment' ? `“${u.text}”` : u.text.replace(/^moved progress/, 'progress')}
                </div>
              ))}
              {d.files.map((f: any) => (
                <div key={f.id} className="card small row" style={{ padding: '10px 12px', gap: 8 }}><I.File />{f.name}<span className="muted">· {fileSize(f.size)}</span></div>
              ))}
            </section>
          )}
        </div>
      )}
    </Frame>
  );
}

function Frame({ children, org, sharedBy }: { children: React.ReactNode; org?: string; sharedBy?: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <header className="row" style={{ padding: '14px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', gap: 10 }}>
        <span style={{ width: 32, height: 32, borderRadius: 8, background: '#3B5BA9', color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{org ? org[0] : '·'}</span>
        <span className="col grow" style={{ gap: 1 }}><span className="small strong">{org ?? 'Lockred'}</span>{sharedBy && <span className="tiny muted">Shared with you by {sharedBy}</span>}</span>
      </header>
      <main style={{ flex: 1, width: '100%', maxWidth: 520, margin: '0 auto', padding: '18px 20px 28px' }}>{children}</main>
      <footer className="tiny muted" style={{ padding: '12px 20px 18px', textAlign: 'center', borderTop: '1px solid var(--border)', background: 'var(--surface)', lineHeight: 1.5 }}>
        This private link opens only this task. Please don’t forward it. <span className="nowrap">Powered by Lockred</span>
      </footer>
    </div>
  );
}
