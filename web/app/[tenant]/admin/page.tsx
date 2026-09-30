'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useTenant } from '@/lib/context';
import { pct, ROLE_LABEL, shortDate, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { Topbar } from '@/components/shell';
import { Avatar, Confirm, download, Empty, ErrorBox, HealthBadge, Loading, Modal, useAction } from '@/components/ui';

const SECTIONS = [
  ['users', 'Users'],
  ['org', 'Organization'],
  ['security', 'Security & policies'],
  ['reporting', 'Reporting rules'],
  ['projects', 'All projects'],
  ['audit', 'Audit log'],
  ['data', 'Data & support access'],
] as const;
type Sec = (typeof SECTIONS)[number][0];

export default function AdminPage() {
  const { me, base } = useTenant();
  const [sec, setSec] = useState<Sec>('users');
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('s') as Sec | null;
    if (s && SECTIONS.some(([k]) => k === s)) setSec(s);
  }, []);
  if (me.tenant!.role !== 'ADMIN') return <div className="page"><div className="card pad">Only admins can open this page.</div></div>;
  return (
    <>
      <Topbar crumbs={[{ label: me.tenant!.name, href: base }, { label: 'Admin' }]} />
      <div className="page">
        {me.tenant!.isDemo && <div className="note warn">This is a demo. Settings can be looked at but not changed.</div>}
        <div className="grid side-nav-grid">
          <nav aria-label="Admin sections" className="col side-nav">
            {SECTIONS.map(([k, label]) => (
              <button key={k} onClick={() => { setSec(k); history.replaceState(null, '', `?s=${k}`); }} aria-current={sec === k ? 'page' : undefined}
                style={{ minHeight: 38, padding: '0 12px', borderRadius: 8, border: 0, textAlign: 'left', fontSize: 14, cursor: 'pointer', background: sec === k ? 'var(--surface)' : 'transparent', fontWeight: sec === k ? 600 : 400, boxShadow: sec === k ? '0 0 0 1px var(--border)' : undefined, color: sec === k ? 'var(--ink)' : 'var(--text2)' }}>
                {label}
              </button>
            ))}
            <Link href={`${base}/billing`} style={{ minHeight: 38, padding: '0 12px', display: 'flex', alignItems: 'center', fontSize: 14, color: 'var(--text2)', textDecoration: 'none' }}>Billing →</Link>
          </nav>
          <div className="col gap16" style={{ minWidth: 0 }}>
            {sec === 'users' && <Users />}
            {sec === 'org' && <Org />}
            {sec === 'security' && <Security />}
            {sec === 'reporting' && <Reporting />}
            {sec === 'projects' && <Projects />}
            {sec === 'audit' && <Audit />}
            {sec === 'data' && <DataSection />}
          </div>
        </div>
      </div>
    </>
  );
}

function Users() {
  const { base } = useTenant();
  const u = useApi<any>('/admin/users');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<any>(null);
  const { run } = useAction();
  if (u.error) return <ErrorBox error={u.error} retry={u.reload} />;
  if (!u.data) return <Loading />;
  const s = u.data.seats;
  return (
    <>
      <div className="page-head">
        <div className="col gap4 grow">
          <h1 className="page-title" style={{ fontSize: 26 }}>Users</h1>
          <p className="small muted">{s.used} of {s.total} seats used{s.pending ? ` (${s.pending} invitation${s.pending === 1 ? '' : 's'} pending)` : ''} · project access is given by each project’s owner · <Link href={`${base}/billing`}>add seats</Link></p>
        </div>
        <button className="btn primary" onClick={() => setInviting(true)}>Invite people</button>
      </div>
      <section className="card scroll-x">
        <div className="table" style={{ minWidth: 820 }}>
          <div className="trow thead" style={{ gridTemplateColumns: UCOLS }}><span>Person</span><span>Organization role</span><span>Projects</span><span>2-step</span><span>Last active</span><span /></div>
          {u.data.members.map((m: any) => (
            <div key={m.id} className="trow" style={{ gridTemplateColumns: UCOLS, opacity: m.status === 'DISABLED' ? 0.6 : 1 }}>
              <span className="row gap8" style={{ minWidth: 0 }}><Avatar name={m.name} /><span className="col" style={{ gap: 1, minWidth: 0 }}><span className="strong ellipsis">{m.name}{m.isYou ? ' (you)' : ''}</span><span className="tiny muted ellipsis">{m.email}</span></span></span>
              <select className="select sm" value={m.role} disabled={m.isYou} aria-label={`Organization role for ${m.name}`}
                onChange={(e) => run(() => api.patch(`/admin/users/${m.id}`, { role: e.target.value }), 'Role changed').then(u.reload)}>
                <option value="ADMIN">Admin</option><option value="MANAGER">Portfolio manager</option><option value="MEMBER">Member</option>
              </select>
              <span className="small" style={{ color: 'var(--text2)' }}>{m.projects}{m.owns ? ` · owns ${m.owns}` : ''}</span>
              <span className={`small strong ${m.mfa ? 'txt-ok' : 'txt-bad'}`}>{m.mfa ? 'On' : 'Off'}</span>
              <span className="small muted">{m.status === 'DISABLED' ? 'Disabled' : timeAgo(m.lastLoginAt)}</span>
              <span className="row gap4" style={{ justifyContent: 'flex-end' }}>
                {!m.isYou && <button className="btn sm" onClick={() => run(() => api.patch(`/admin/users/${m.id}`, { status: m.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }), m.status === 'ACTIVE' ? 'Disabled' : 'Enabled').then(u.reload)}>{m.status === 'ACTIVE' ? 'Disable' : 'Enable'}</button>}
                {!m.isYou && <button className="btn sm danger" onClick={() => setRemoving(m)}>Remove</button>}
              </span>
            </div>
          ))}
        </div>
      </section>
      {u.data.invites.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Pending invitations</h2></div>
          {u.data.invites.map((i: any) => (
            <div key={i.id} className="trow" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 100px' }}>
              <span className="ellipsis">{i.email}</span><span className="small">{ROLE_LABEL[i.role]}</span><span className="small muted">Expires {shortDate(i.expiresAt)}</span>
              <button className="btn sm" onClick={() => run(() => api.del(`/admin/invites/${i.id}`), 'Invitation withdrawn').then(u.reload)}>Withdraw</button>
            </div>
          ))}
        </section>
      )}
      <div className="grid g3">
        {[['Admin', 'Everything in the organization: users, settings, billing, and every project (read-only unless they’re on the team).'],
          ['Portfolio manager', 'Sees all projects and their progress. Can change owners. Edits only projects they’re on.'],
          ['Member', 'Sees only projects they’ve been added to, as owner, co-lead or contributor.']].map(([t, d]) => (
          <div key={t} className="card pad col gap6"><strong className="small">{t}</strong><span className="small" style={{ color: 'var(--text2)', lineHeight: 1.5 }}>{d}</span></div>
        ))}
      </div>
      {inviting && <Invite onClose={() => setInviting(false)} onDone={() => { setInviting(false); u.reload(); }} />}
      {removing && <Confirm title={`Remove ${removing.name}?`} text="They lose access to the organization and all its projects. Their past activity stays." confirmLabel="Remove" danger
        onConfirm={() => run(() => api.del(`/admin/users/${removing.id}`), `${removing.name} removed`).then(u.reload)} onClose={() => setRemoving(null)} />}
    </>
  );
}
const UCOLS = 'minmax(0,1.8fr) 190px minmax(0,0.9fr) 70px 110px 170px';

function Invite({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState('MEMBER');
  const { busy, run } = useAction();
  const list = emails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post('/admin/invites', { emails: list, role }));
    if (r) { await run(async () => r, r.invited ? `${r.invited} invitation${r.invited === 1 ? '' : 's'} sent` : 'Everyone is already a member'); onDone(); }
  };
  return (
    <Modal title="Invite people" subtitle="They get an email with a link that works for 14 days." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="inv" disabled={busy || !list.length}>Send {list.length || ''} invitation{list.length === 1 ? '' : 's'}</button></>}>
      <form id="inv" className="col gap14" onSubmit={submit}>
        <label className="field">Email addresses <span className="hint">Separate with commas or new lines. Paste a whole list if you like.</span>
          <textarea className="textarea" rows={4} autoFocus value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="anna@company.se, erik@company.se" />
        </label>
        <label className="field">Role
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="MEMBER">Member — sees projects they’re added to</option>
            <option value="MANAGER">Portfolio manager — sees all projects, can change owners</option>
            <option value="ADMIN">Admin — can configure everything</option>
          </select>
        </label>
      </form>
    </Modal>
  );
}

function useSettings() {
  return useApi<any>('/admin/settings');
}

function Org() {
  const s = useSettings();
  const { reloadMe } = useTenant();
  const { busy, run } = useAction();
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (s.data) setF({ name: s.data.name, currency: s.data.currency, timezone: s.data.timezone }); }, [s.data]);
  if (!s.data || !f) return <Loading />;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.patch('/admin/settings', f), 'Saved');
    if (r) { s.reload(); reloadMe(); }
  };
  return (
    <form className="card pad col gap14" onSubmit={save}>
      <h1 className="page-title" style={{ fontSize: 22 }}>Organization</h1>
      <div className="grid g2">
        <label className="field">Name<input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Web address<input className="input" disabled value={`${typeof window !== 'undefined' ? window.location.host : ''}/${s.data.slug}`} /><span className="hint">Contact support to change it.</span></label>
        <label className="field">Currency
          <select className="select" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            {['SEK', 'NOK', 'DKK', 'EUR', 'USD', 'GBP'].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">Time zone
          <select className="select" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
            {['Europe/Stockholm', 'Europe/Oslo', 'Europe/Copenhagen', 'Europe/Helsinki', 'Europe/London', 'Europe/Berlin', 'UTC'].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <div><button className="btn primary" disabled={busy}>Save</button></div>
    </form>
  );
}

function Security() {
  const s = useSettings();
  const { busy, run } = useAction();
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (s.data) setF({ ...s.data.settings, domains: s.data.settings.allowedDomains.join(', ') }); }, [s.data]);
  if (!s.data || !f) return <Loading />;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const settings = {
      require2faForAdmins: f.require2faForAdmins,
      allowedDomains: f.domains.split(/[\s,;]+/).map((x: string) => x.trim().toLowerCase()).filter(Boolean),
      sessionHours: Number(f.sessionHours),
      taskLinkMaxDays: Number(f.taskLinkMaxDays),
      taskLinkRoles: f.taskLinkRoles,
      whoCanCreateProjects: f.whoCanCreateProjects,
    };
    const r = await run(() => api.patch('/admin/settings', { settings }), 'Saved');
    if (r) s.reload();
  };
  const Row = ({ title, help, children }: { title: string; help: string; children: React.ReactNode }) => (
    <div className="row wrap" style={{ gap: 16, padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
      <span className="col grow" style={{ gap: 2, minWidth: 240 }}><span style={{ fontSize: 15, fontWeight: 500 }}>{title}</span><span className="small muted">{help}</span></span>
      <span style={{ minWidth: 220 }}>{children}</span>
    </div>
  );
  return (
    <form className="col gap16" onSubmit={save}>
      <h1 className="page-title" style={{ fontSize: 26 }}>Security &amp; policies</h1>
      <section className="card">
        <Row title="Require 2-step sign-in for admins" help="Admins must use an authenticator app before they can change settings.">
          <label className="check"><input type="checkbox" checked={f.require2faForAdmins} onChange={(e) => setF({ ...f, require2faForAdmins: e.target.checked })} />Required</label>
        </Row>
        <Row title="Allowed email domains" help="Only these domains can be invited. Leave empty to allow any.">
          <input className="input sm" value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} placeholder="company.se" />
        </Row>
        <Row title="Session length" help="Sign people out after this many hours without activity.">
          <select className="select sm" value={f.sessionHours} onChange={(e) => setF({ ...f, sessionHours: e.target.value })}>{[4, 8, 12, 24, 72, 168].map((h) => <option key={h} value={h}>{h} hours</option>)}</select>
        </Row>
        <Row title="Who can create projects" help="Everyone, or only admins and portfolio managers.">
          <select className="select sm" value={f.whoCanCreateProjects} onChange={(e) => setF({ ...f, whoCanCreateProjects: e.target.value })}>
            <option value="EVERYONE">Everyone</option><option value="MANAGERS">Admins and managers</option>
          </select>
        </Row>
        <Row title="Task links: longest lifetime" help="Owners can pick shorter, never longer.">
          <select className="select sm" value={f.taskLinkMaxDays} onChange={(e) => setF({ ...f, taskLinkMaxDays: e.target.value })}>{[7, 30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} days</option>)}</select>
        </Row>
        <Row title="Task links: who can create them" help="Project roles allowed to share a task outside the organization.">
          <select className="select sm" value={f.taskLinkRoles.join(',')} onChange={(e) => setF({ ...f, taskLinkRoles: e.target.value.split(',') })}>
            <option value="OWNER,COLEAD">Owners and co-leads</option><option value="OWNER">Only owners</option>
          </select>
        </Row>
        <Row title="Single sign-on" help="Microsoft Entra ID and Google Workspace.">
          <span className="badge neutral">Coming soon</span>
        </Row>
      </section>
      <div><button className="btn primary" disabled={busy}>Save policies</button></div>
    </form>
  );
}

function Reporting() {
  const s = useSettings();
  const { busy, run } = useAction();
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (s.data) setF(s.data.settings); }, [s.data]);
  if (!s.data || !f) return <Loading />;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.patch('/admin/settings', { settings: { riskThreshold: Number(f.riskThreshold), behindThreshold: Number(f.behindThreshold), weeklyReport: f.weeklyReport } }), 'Saved');
    if (r) s.reload();
  };
  return (
    <form className="card pad col gap16" onSubmit={save}>
      <h1 className="page-title" style={{ fontSize: 22 }}>Reporting rules</h1>
      <p className="small muted">These decide when a project is flagged in the portfolio and in reports.</p>
      <div className="grid g2">
        <label className="field">“At risk” when behind plan by more than
          <span className="row gap8"><input className="input" type="number" min={0} max={100} value={f.riskThreshold} onChange={(e) => setF({ ...f, riskThreshold: e.target.value })} style={{ width: 100 }} />points</span>
          <span className="hint">…or when the budget forecast goes over.</span>
        </label>
        <label className="field">“Behind” when behind plan by more than
          <span className="row gap8"><input className="input" type="number" min={0} max={100} value={f.behindThreshold} onChange={(e) => setF({ ...f, behindThreshold: e.target.value })} style={{ width: 100 }} />points</span>
          <span className="hint">…or when more has been spent than approved.</span>
        </label>
      </div>
      <label className="check"><input type="checkbox" checked={f.weeklyReport} onChange={(e) => setF({ ...f, weeklyReport: e.target.checked })} />Email a weekly status every Monday morning to project owners, co-leads and managers</label>
      <div><button className="btn primary" disabled={busy}>Save</button></div>
    </form>
  );
}

function Projects() {
  const { base } = useTenant();
  const p = useApi<any[]>('/admin/projects');
  const [deleting, setDeleting] = useState<any>(null);
  const { run } = useAction();
  if (!p.data) return <Loading />;
  return (
    <>
      <h1 className="page-title" style={{ fontSize: 26 }}>All projects</h1>
      <section className="card scroll-x">
        <div className="table" style={{ minWidth: 760 }}>
          <div className="trow thead" style={{ gridTemplateColumns: PCOLS }}><span>Project</span><span>Owner</span><span>Progress</span><span>Health</span><span /></div>
          {p.data.length === 0 && <Empty title="No projects yet" />}
          {p.data.map((x) => (
            <div key={x.id} className="trow" style={{ gridTemplateColumns: PCOLS, opacity: x.archived ? 0.65 : 1 }}>
              <Link href={`${base}/p/${x.id}`} className="strong ellipsis">{x.name}{x.archived ? ' (archived)' : ''}</Link>
              <span className="small ellipsis">{x.owner?.name ?? '—'}</span>
              <span className="small">{pct(x.progress)}</span>
              <span>{x.archived ? <span className="badge neutral">Archived</span> : <HealthBadge health={x.health} />}</span>
              <span className="row gap4" style={{ justifyContent: 'flex-end' }}>
                <button className="btn sm" onClick={() => run(() => api.post(`/admin/projects/${x.id}/archive`, { archived: !x.archived }), x.archived ? 'Restored' : 'Archived').then(p.reload)}>{x.archived ? 'Restore' : 'Archive'}</button>
                {x.archived && <button className="btn sm danger" onClick={() => setDeleting(x)}>Delete</button>}
              </span>
            </div>
          ))}
        </div>
      </section>
      {deleting && <Confirm title={`Delete ${deleting.name} for good?`} text="Everything in the project — tasks, budget, costs and files — is deleted. This can’t be undone. Export your data first if you need it." confirmLabel="Delete forever" danger
        onConfirm={() => run(() => api.del(`/admin/projects/${deleting.id}`), 'Project deleted').then(p.reload)} onClose={() => setDeleting(null)} />}
    </>
  );
}
const PCOLS = 'minmax(0,2fr) minmax(0,1.2fr) 90px 110px 190px';

const ACTIONS: Record<string, string> = {
  'tenant.created': 'created the organization', 'member.invited': 'invited people', 'member.joined': 'joined', 'member.updated': 'changed a user',
  'member.removed': 'removed a user', 'settings.updated': 'changed settings', 'project.created': 'created a project', 'project.owner_changed': 'changed a project owner',
  'project.member_added': 'gave someone project access', 'project.member_removed': 'removed someone from a project', 'project.member_role': 'changed a project role',
  'project.archived': 'archived a project', 'project.restored': 'restored a project', 'project.deleted': 'deleted a project', 'tollgate.passed': 'passed a tollgate',
  'tollgate.reopened': 'reopened a tollgate', 'task_link.created': 'shared a task outside', 'task_link.revoked': 'revoked a task link', 'task_link.resent': 'sent a new task link',
  'billing.seats': 'changed the number of seats', 'billing.subscription': 'subscription changed', 'data.exported': 'exported all data',
  'support_access.granted': 'gave Lockred support access', 'support_access.revoked': 'removed Lockred support access',
};

function Audit() {
  const a = useApi<any[]>('/admin/audit');
  const [more, setMore] = useState<any[]>([]);
  const all = [...(a.data ?? []), ...more];
  if (!a.data) return <Loading />;
  const loadMore = async () => {
    const last = all[all.length - 1];
    if (!last) return;
    const r = await api.get<any[]>(`/admin/audit?before=${encodeURIComponent(last.createdAt)}`);
    setMore((m) => [...m, ...r]);
  };
  return (
    <>
      <h1 className="page-title" style={{ fontSize: 26 }}>Audit log</h1>
      <p className="small muted">Who changed what and when. Kept for as long as the organization exists.</p>
      <section className="card">
        {all.length === 0 && <div className="empty">Nothing logged yet.</div>}
        {all.map((x) => (
          <div key={x.id} className="row top small" style={{ gap: 12, padding: '10px 20px', borderBottom: '1px solid var(--line)' }}>
            <span className="muted nowrap" style={{ width: 130 }}>{new Date(x.createdAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</span>
            <span className="grow"><strong>{x.actorName}</strong> {ACTIONS[x.action] ?? x.action}{x.data?.reason ? ` — “${x.data.reason}”` : ''}{x.data?.name ? ` (${x.data.name})` : ''}</span>
          </div>
        ))}
        {all.length >= 100 && <div style={{ padding: 12 }}><button className="btn sm" onClick={loadMore}>Show older</button></div>}
      </section>
    </>
  );
}

function DataSection() {
  const s = useSettings();
  const { run } = useAction();
  if (!s.data) return <Loading />;
  const until = s.data.supportAccessUntil ? new Date(s.data.supportAccessUntil) : null;
  const active = until && until > new Date();
  return (
    <>
      <h1 className="page-title" style={{ fontSize: 26 }}>Data &amp; support access</h1>
      <section className="card pad col gap8">
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Export everything</h2>
        <p className="small muted">Download all projects, tasks, budgets, costs, KPIs, activity and the audit log as one JSON file. Uploaded files are listed but not included.</p>
        <div><button className="btn" onClick={() => download('/admin/export')}>Download export</button></div>
      </section>
      <section className="card pad col gap8">
        <div className="row"><h2 className="grow" style={{ fontSize: 16, fontWeight: 600 }}>Let Lockred support look</h2><span className={`badge ${active ? 'warn' : 'neutral'}`}>{active ? `On until ${until!.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}` : 'Off'}</span></div>
        <p className="small muted">By default we can’t see your projects. If you’ve asked for help, you can let our support team see the portfolio overview for a limited time. It’s logged in the audit log.</p>
        <div className="row gap8">
          {active
            ? <button className="btn" onClick={() => run(() => api.post('/admin/support-access', { hours: 0 }), 'Support access removed').then(s.reload)}>Turn off now</button>
            : <>
                <button className="btn" onClick={() => run(() => api.post('/admin/support-access', { hours: 24 }), 'Support can look for 24 hours').then(s.reload)}>Allow for 24 hours</button>
                <button className="btn" onClick={() => run(() => api.post('/admin/support-access', { hours: 72 }), 'Support can look for 3 days').then(s.reload)}>Allow for 3 days</button>
              </>}
        </div>
      </section>
      <section className="card pad col gap8">
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Delete the organization</h2>
        <p className="small muted">Cancel the subscription under Billing, then contact support. We delete everything 30 days after cancellation.</p>
      </section>
    </>
  );
}
