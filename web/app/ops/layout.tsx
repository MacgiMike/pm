'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { Me } from '@/lib/context';
import { useApi } from '@/lib/useApi';
import { BrandMark, I } from '@/components/icons';
import { Loading, logout } from '@/components/ui';

const TABS = [
  ['/ops', 'Tenants'],
  ['/ops/support', 'Support'],
  ['/ops/ideas', 'Ideas'],
  ['/ops/affiliates', 'Affiliates'],
  ['/ops/demos', 'Demo portals'],
  ['/ops/operators', 'Operators'],
  ['/ops/system', 'System'],
] as const;

export default function OpsLayout({ children }: { children: ReactNode }) {
  const me = useApi<Me>('/auth/me');
  const probe = useApi<any>(me.data?.account.isOperator ? '/ops/overview' : null);
  const path = usePathname();

  let body: ReactNode = children;
  if (!me.data) body = <Loading />;
  else if (!me.data.account.isOperator) body = <Blocked title="Operators only" text="This console is for the Lockred team." />;
  else if (probe.error instanceof ApiError && probe.error.code === 'MFA_SETUP_REQUIRED') {
    body = <Blocked title="Set up 2-step sign-in first" text="The operator console requires 2-step sign-in." action={<Link href="/account" className="btn primary">Set it up</Link>} />;
  } else if (!probe.data && !probe.error) body = <Loading />;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#EEEDE9' }}>
      <header className="row" style={{ minHeight: 60, padding: '0 clamp(12px, 3vw, 28px)', background: 'var(--ink)', color: '#E8E6E1', gap: 14, flexWrap: 'wrap' }}>
        <Link href="/ops" className="row gap8" style={{ color: 'inherit', textDecoration: 'none' }}><BrandMark /><span className="brand-name" style={{ fontSize: 17 }}>Lockred</span></Link>
        <span className="badge" style={{ background: '#D2433C', color: '#fff', letterSpacing: '0.08em', fontSize: 11 }}>OPERATOR</span>
        <nav aria-label="Operator sections" className="row" style={{ gap: 4, overflowX: 'auto', flex: 1 }}>
          {TABS.map(([href, label]) => {
            const active = href === '/ops' ? path === '/ops' || path.startsWith('/ops/tenants') : path.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined}
                style={{ minHeight: 36, padding: '0 14px', borderRadius: 8, display: 'flex', alignItems: 'center', fontSize: 14, textDecoration: 'none', whiteSpace: 'nowrap', background: active ? 'var(--side-3)' : 'transparent', color: active ? '#fff' : 'var(--side-text)' }}>
                {label}
              </Link>
            );
          })}
        </nav>
        {me.data && <span className="small" style={{ color: '#A5A7AE' }}>{me.data.account.name}{me.data.account.totpEnabled ? ' · 2-step on' : ''}</span>}
        <Link href="/select" className="icon-btn" aria-label="Leave operator console" style={{ color: '#C4C3BE' }}><I.Grid /></Link>
        <button className="icon-btn" aria-label="Sign out" onClick={logout} style={{ color: '#C4C3BE' }}><I.Logout /></button>
      </header>
      <main style={{ flex: 1, padding: 'clamp(16px, 2.5vw, 28px)', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1480, width: '100%', margin: '0 auto' }}>{body}</main>
    </div>
  );
}

function Blocked({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="card pad col gap8" style={{ maxWidth: 560 }}>
      <h1 className="page-title" style={{ fontSize: 22 }}>{title}</h1>
      <p className="muted">{text}</p>
      {action && <div>{action}</div>}
    </div>
  );
}
