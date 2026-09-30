'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, errorText } from '@/lib/api';
import { longDate } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { BrandMark, I } from './icons';
import { Loading, useToast } from './ui';

const ROLES = [
  { as: 'manager', kicker: 'Manager', title: 'Portfolio manager', text: 'See every project at once, spot what’s behind or over budget, and hand a project to a new owner.', cta: 'Enter as manager' },
  { as: 'owner', kicker: 'Owner', title: 'Project owner', text: 'Run one project end to end: directives, KPIs, plan, tollgates, budget, invoices and who gets access.', cta: 'Enter as owner' },
  { as: 'contributor', kicker: 'Team', title: 'Contributor', text: 'Work the tasks. Update progress and watch it roll up into the swim lane straight away.', cta: 'Enter as contributor' },
  { as: 'guest', kicker: 'External', title: 'Consultant with a task link', text: 'No account, no password. One link opens one task, on any phone.', cta: 'Open the task link' },
] as const;

export function DemoEntry({ demoKey }: { demoKey: string }) {
  const info = useApi<any>(`/demo/${demoKey}`);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const enter = async (as: string) => {
    setBusy(as);
    try {
      const r = await api.post(`/demo/${demoKey}/enter`, { as });
      window.location.href = r.next;
    } catch (e) {
      toast.show(errorText(e), true);
      setBusy(null);
    }
  };
  const signup = info.data?.affiliateCode ? `/api/r/${info.data.affiliateCode}?to=/signup` : '/signup';
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="row" style={{ minHeight: 64, padding: '0 clamp(16px, 4vw, 48px)', background: 'var(--surface)', borderBottom: '1px solid var(--border)', gap: 14 }}>
        <BrandMark />
        <span className="brand-name">Lockred</span>
        <span className="badge warn">LIVE DEMO</span>
        <span className="grow" />
        {info.data?.sharedBy && <span className="small muted">Shared by <strong style={{ color: 'var(--ink)' }}>{info.data.sharedBy}</strong></span>}
        <a href={signup} className="btn primary">Start free trial</a>
      </header>
      <main style={{ flex: 1, padding: 'clamp(24px, 5vw, 56px) clamp(16px, 6vw, 96px)', display: 'flex', flexDirection: 'column', gap: 36 }}>
        {info.error ? (
          <div className="card pad col gap8" style={{ maxWidth: 560 }}>
            <h1 className="page-title" style={{ fontSize: 22 }}>This demo isn’t available</h1>
            <p className="muted">The link may be old. <Link href="/demo">Open the public demo</Link> instead.</p>
          </div>
        ) : !info.data ? <Loading /> : (
          <>
            <div className="col gap8" style={{ maxWidth: 760 }}>
              <h1 className="display" style={{ fontSize: 'clamp(30px, 4vw, 40px)', fontWeight: 700, letterSpacing: '-0.02em' }}>Pick who you want to be</h1>
              <p style={{ fontSize: 17, lineHeight: 1.5, color: 'var(--text2)' }}>This demo is {info.data.name}, a fictional logistics company with eight projects. Click around, change things, break things — it’s all sample data.</p>
            </div>
            <div className="grid g4" style={{ gap: 20 }}>
              {ROLES.map((r) => (
                <button key={r.as} onClick={() => enter(r.as)} disabled={!!busy} className="card col"
                  style={{ padding: 24, gap: 14, minHeight: 300, textAlign: 'left', cursor: 'pointer', borderRadius: 14 }}>
                  <span className="section-title">{r.kicker}</span>
                  <span className="display" style={{ fontSize: 22, fontWeight: 700 }}>{r.title}</span>
                  <span style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text2)', flex: 1 }}>{r.text}</span>
                  <span className="strong small" style={{ color: 'var(--red)' }}>{busy === r.as ? 'Opening…' : `${r.cta} →`}</span>
                </button>
              ))}
            </div>
            <div className="card row" style={{ padding: '16px 20px', gap: 12, fontSize: 14, color: 'var(--text2)' }}>
              <I.Reset size={18} />
              <span>This demo resets to fresh sample data on the 1st of every month. Next reset: <strong style={{ color: 'var(--ink)' }}>{longDate(info.data.nextReset)}</strong>.</span>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
