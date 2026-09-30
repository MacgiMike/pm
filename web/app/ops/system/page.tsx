'use client';
import { fileSize, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { Loading } from '@/components/ui';

export default function OpsSystemPage() {
  const s = useApi<any>('/ops/system');
  if (!s.data) return <Loading />;
  const d = s.data;
  const backupAgeH = d.backup ? (Date.now() - new Date(d.backup.at).getTime()) / 3_600_000 : null;
  const rows: [string, string, 'ok' | 'warn' | 'bad'][] = [
    ['Database', d.database.status === 'ok' ? `OK · ${d.database.latencyMs} ms` : d.database.status, d.database.status === 'ok' ? 'ok' : 'bad'],
    ['Nightly backup', d.backup ? `${d.backup.file} · ${fileSize(d.backup.size)} · ${timeAgo(d.backup.at)}` : 'No backup found', !d.backup ? 'bad' : backupAgeH! > 30 ? 'warn' : 'ok'],
    ['Stripe', d.stripe.configured ? `Configured · last webhook ${d.stripe.lastWebhookAt ? timeAgo(d.stripe.lastWebhookAt) : 'never'}` : 'Not configured — billing is off', d.stripe.configured ? 'ok' : 'warn'],
    ['Email (SMTP)', d.email.configured ? 'Configured' : 'Not configured — emails are only written to the API log', d.email.configured ? 'ok' : 'warn'],
  ];
  const color = { ok: 'var(--green)', warn: 'var(--amber-mid)', bad: 'var(--red)' };
  return (
    <div className="grid split" style={{ alignItems: 'start' }}>
      <section className="card">
        <div className="card-head"><h2>Health</h2><button className="btn sm" onClick={s.reload}>Refresh</button></div>
        {rows.map(([name, value, st]) => (
          <div key={name} className="row small" style={{ gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--line)' }}>
            <span className="dot" style={{ background: color[st] }} /><span className="strong" style={{ width: 140 }}>{name}</span><span className="grow" style={{ color: 'var(--text2)' }}>{value}</span>
          </div>
        ))}
      </section>
      <section className="card pad col gap8">
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Totals</h2>
        <div className="grid g2 small">
          <span className="muted">Tenants</span><span className="mono">{d.counts.tenants}</span>
          <span className="muted">User accounts</span><span className="mono">{d.counts.accounts}</span>
          <span className="muted">Projects</span><span className="mono">{d.counts.projects}</span>
          <span className="muted">Tasks</span><span className="mono">{d.counts.tasks}</span>
          <span className="muted">Version</span><span className="mono">{d.version}</span>
          <span className="muted">API uptime</span><span className="mono">{Math.floor(d.uptimeSeconds / 3600)} h {Math.floor((d.uptimeSeconds % 3600) / 60)} min</span>
        </div>
      </section>
    </div>
  );
}
