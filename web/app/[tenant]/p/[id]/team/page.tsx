'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useProject, useTenant } from '@/lib/context';
import { ROLE_LABEL, shortDate, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { TeamAdd } from '@/components/project';
import { Topbar } from '@/components/shell';
import { Avatar, Confirm, ErrorBox, Loading, useAction } from '@/components/ui';

const ROLES = [
  { name: 'Owner', can: ['Everything in the project', 'Gives and removes access'], cannot: [] as string[] },
  { name: 'Co-lead', can: ['Plan, tasks, tollgates, budget, KPIs', 'Books invoices and pulls reports'], cannot: ['Give or remove access'] },
  { name: 'Contributor', can: ['Tasks and swim lanes', 'Progress, comments, files'], cannot: ['Budget, KPIs and settings'] },
  { name: 'Task link (external)', can: ['One task: progress, comments, files'], cannot: ['No login, nothing else in the project'] },
];

export default function TeamPage() {
  const { me, base } = useTenant();
  const { data: proj, base: pb, reload: reloadProject } = useProject();
  const m = useApi<any>(`/projects/${proj.id}/members`);
  const [removing, setRemoving] = useState<any>(null);
  const [revoking, setRevoking] = useState<any>(null);
  const { run } = useAction();
  const owner = proj.can.members;
  const refresh = () => { m.reload(); reloadProject(); };

  return (
    <>
      <Topbar crumbs={[{ label: me.tenant!.role === 'MEMBER' ? 'Projects' : 'Portfolio', href: base }, { label: proj.name, href: pb }, { label: owner ? 'Team & access' : 'Team' }]} />
      <div className="page">
        <div className="col gap4">
          <h1 className="page-title">{owner ? 'Team & access' : 'Team'}</h1>
          <p className="small muted">Only people on this list can open the project.{owner ? ' Only you, as owner, can change it.' : ' Only the owner can change it.'}</p>
        </div>
        {m.error && <ErrorBox error={m.error} retry={m.reload} />}
        {!m.data && !m.error && <Loading />}
        {m.data && (
          <div className="grid aside-right">
            <div className="col gap16">
              {owner && <TeamAddOnly onChanged={refresh} />}
              <section className="card" aria-label="Members">
                <div className="trow thead" style={{ gridTemplateColumns: MCOLS }}><span>Person</span><span>Role in project</span><span>Added</span><span /></div>
                {m.data.members.map((x: any) => (
                  <div key={x.id} className="trow" style={{ gridTemplateColumns: MCOLS }}>
                    <span className="row gap8" style={{ minWidth: 0 }}><Avatar name={x.name} /><span className="col" style={{ gap: 1, minWidth: 0 }}><span className="strong ellipsis">{x.name}</span><span className="tiny muted ellipsis">{x.email}</span></span></span>
                    {x.role === 'OWNER' || !owner ? (
                      <span className="small"><strong>{ROLE_LABEL[x.role]}</strong>{x.role === 'OWNER' && owner && <span className="tiny muted"> · changed by a manager</span>}</span>
                    ) : (
                      <select className="select sm" style={{ width: 160 }} value={x.role} aria-label={`Role for ${x.name}`}
                        onChange={(e) => run(() => api.patch(`/projects/${proj.id}/members/${x.id}`, { role: e.target.value }), 'Role changed').then(refresh)}>
                        <option value="COLEAD">Co-lead</option>
                        <option value="CONTRIBUTOR">Contributor</option>
                      </select>
                    )}
                    <span className="tiny muted">{shortDate(x.addedAt)}{x.addedByName ? ` by ${x.addedByName}` : ''}</span>
                    {owner && x.role !== 'OWNER' ? <button className="btn sm danger" onClick={() => setRemoving(x)}>Remove</button> : <span />}
                  </div>
                ))}
                <div className="small muted" style={{ padding: '12px 20px' }}>Organization admins and portfolio managers can always see this project, read-only. They don’t appear on this list.</div>
              </section>

              <section className="card" aria-label="Task links">
                <div className="card-head"><h2>People outside with a task link</h2><span className="small muted">Share from a task</span></div>
                {m.data.links.length === 0 ? <div className="empty">No tasks are shared outside the organization.</div> : m.data.links.map((l: any) => (
                  <div key={l.id} className="trow" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1.4fr) minmax(0,1fr) 90px' }}>
                    <span className="row gap8" style={{ minWidth: 0 }}><Avatar name={l.guestName} guest /><span className="col" style={{ gap: 1, minWidth: 0 }}><span className="strong ellipsis">{l.guestName}</span><span className="tiny muted ellipsis">{l.guestOrg || l.guestEmail || ''}</span></span></span>
                    <Link href={`${pb}/tasks/${l.task.id}`} className="ellipsis">{l.task.title}</Link>
                    <span className="tiny muted">{l.active ? `${l.lastUsedAt ? `Used ${timeAgo(l.lastUsedAt)}` : 'Not opened yet'} · until ${shortDate(l.expiresAt)}` : 'Expired'}</span>
                    {proj.can.links ? <button className="btn sm danger" onClick={() => setRevoking(l)}>Revoke</button> : <span />}
                  </div>
                ))}
              </section>
            </div>
            <aside className="col gap14">
              <div className="section-title" style={{ paddingTop: 8 }}>What each role can do</div>
              {ROLES.map((r) => (
                <div key={r.name} className="card pad col gap8" style={{ padding: '14px 16px' }}>
                  <strong style={{ fontSize: 15 }}>{r.name}</strong>
                  {r.can.map((c) => <span key={c} className="row top small" style={{ gap: 8, color: 'var(--text2)' }}><span className="txt-ok strong" aria-hidden="true">✓</span>{c}</span>)}
                  {r.cannot.map((c) => <span key={c} className="row top small muted" style={{ gap: 8 }}><span className="txt-bad strong" aria-hidden="true">✕</span>{c}</span>)}
                </div>
              ))}
            </aside>
          </div>
        )}
      </div>
      {removing && (
        <Confirm title={`Remove ${removing.name}?`} text="They lose access to the project right away. Tasks assigned to them become unassigned." confirmLabel="Remove" danger
          onConfirm={() => run(() => api.del(`/projects/${proj.id}/members/${removing.id}`), `${removing.name} removed`).then(refresh)} onClose={() => setRemoving(null)} />
      )}
      {revoking && (
        <Confirm title={`Stop sharing with ${revoking.guestName}?`} text="The link stops working immediately." confirmLabel="Revoke" danger
          onConfirm={() => run(() => api.del(`/projects/${proj.id}/links/${revoking.id}`), 'Link revoked').then(refresh)} onClose={() => setRevoking(null)} />
      )}
    </>
  );
}

const MCOLS = 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) 90px';

function TeamAddOnly({ onChanged }: { onChanged: () => void }) {
  const { data: proj } = useProject();
  return <TeamAdd projectId={proj.id} onChanged={onChanged} showList={false} />;
}
