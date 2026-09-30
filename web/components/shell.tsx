'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Me, ProjectHeader } from '@/lib/context';
import { ROLE_LABEL } from '@/lib/format';
import { BrandMark, I } from './icons';
import { Avatar, logout } from './ui';

function NavLink({ href, icon, children, exact, count }: { href: string; icon: ReactNode; children: ReactNode; exact?: boolean; count?: number }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(href + '/');
  return (
    <Link href={href} className="nav" aria-current={active ? 'page' : undefined}>
      {icon}
      <span>{children}</span>
      {count !== undefined && count > 0 && <span className="count">{count}</span>}
    </Link>
  );
}

const healthDot: Record<string, string> = { ON_TRACK: '#3FA58F', AT_RISK: '#E39A3B', BEHIND: '#D2433C' };

export function Sidebar({ me, base, project, myTaskCount, open, onClose }: {
  me: Me; base: string; project: ProjectHeader | null; myTaskCount?: number; open: boolean; onClose: () => void;
}) {
  const t = me.tenant!;
  const [menu, setMenu] = useState<'tenant' | 'user' | null>(null);
  const router = useRouter();
  const path = usePathname();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    setMenu(null);
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-menu]')) setMenu(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);

  const switchTo = async (slug: string) => {
    await api.post('/auth/switch', { slug });
    router.push(`/${slug}`);
  };

  const p = project;
  const pb = p ? `${base}/p/${p.id}` : '';
  const roleLabel = p && path.startsWith(pb) ? ROLE_LABEL[p.role] : ROLE_LABEL[t.role];

  return (
    <>
      {open && <div className="scrim" onClick={onClose} />}
      <nav ref={ref} className={`side ${open ? 'open' : ''}`} aria-label="Main navigation">
        <Link href={base} className="brand"><BrandMark /><span className="brand-name">Lockred</span></Link>

        <div style={{ position: 'relative' }} data-menu>
          <button className="tenant-switch" onClick={() => setMenu(menu === 'tenant' ? null : 'tenant')} aria-expanded={menu === 'tenant'} aria-label={`Organization: ${t.name}. Switch organization`}>
            <span className="row gap8 ellipsis">
              <span style={{ width: 20, height: 20, borderRadius: 5, background: '#3B5BA9', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                {t.name[0]?.toUpperCase()}
              </span>
              <span className="ellipsis">{t.name}</span>
            </span>
            <I.Chevron size={14} />
          </button>
          {menu === 'tenant' && (
            <div className="menu" style={{ top: 46, left: 0, right: 0 }}>
              {me.tenants.map((x) => (
                <button key={x.id} onClick={() => switchTo(x.slug)}>
                  <span className="grow ellipsis">{x.name}</span>
                  {x.slug === t.slug && <I.Check />}
                </button>
              ))}
            </div>
          )}
        </div>

        {t.isDemo && (
          <div style={{ fontSize: 12, lineHeight: 1.45, color: '#F3D19C', background: '#3A2E1C', borderRadius: 8, padding: '8px 10px' }}>
            Demo with sample data. It resets on the 1st of every month.{' '}
            <Link href="/signup" style={{ color: '#fff', fontWeight: 600 }}>Start a free trial</Link>
          </div>
        )}

        <div className="side-section">
          <div className="side-label">Workspace</div>
          <NavLink href={base} exact icon={<I.Grid />}>Portfolio</NavLink>
          <NavLink href={`${base}/my-tasks`} icon={<I.CheckSquare />} count={myTaskCount}>My tasks</NavLink>
          <NavLink href={`${base}/reports`} icon={<I.Chart />}>Reports</NavLink>
        </div>

        {p && (
          <div className="side-section">
            <div className="side-label">Project</div>
            <div className="side-project">
              <span className="dot" style={{ background: healthDot[p.health] ?? '#8E9098' }} />
              <span className="ellipsis">{p.name}</span>
            </div>
            <NavLink href={pb} exact icon={<I.Home />}>Overview</NavLink>
            {p.role !== 'CONTRIBUTOR' && <NavLink href={`${pb}/setup`} icon={<I.Target />}>Directives &amp; KPIs</NavLink>}
            <NavLink href={`${pb}/plan`} icon={<I.List />}>Plan &amp; tollgates</NavLink>
            <NavLink href={`${pb}/lanes`} icon={<I.Lanes />}>Swim lanes</NavLink>
            {p.can.budgetView && <NavLink href={`${pb}/budget`} icon={<I.Wallet />}>Budget &amp; costs</NavLink>}
            <NavLink href={`${pb}/team`} icon={<I.Users />}>{p.can.members ? 'Team & access' : 'Team'}</NavLink>
            <NavLink href={`${pb}/report`} icon={<I.Chart />}>Status report</NavLink>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <div className="side-section">
          {t.role === 'ADMIN' && <NavLink href={`${base}/admin`} icon={<I.Sliders />}>Admin</NavLink>}
          {t.role === 'ADMIN' && <NavLink href={`${base}/billing`} icon={<I.Card />}>Billing</NavLink>}
          <NavLink href={`${base}/support`} icon={<I.Help />}>Help &amp; support</NavLink>
        </div>

        <div style={{ position: 'relative' }} data-menu>
          {menu === 'user' && (
            <div className="menu" style={{ bottom: 58, left: 0, right: 0 }}>
              {!me.account.isDemo && <Link href="/account"><I.User />Your account</Link>}
              {me.tenants.length > 1 && <Link href="/select"><I.Grid />Switch organization</Link>}
              {me.affiliate && <Link href="/partners"><I.Gift />Partner portal</Link>}
              {me.account.isOperator && <Link href="/ops"><I.Shield />Operator console</Link>}
              <hr />
              <button onClick={logout}><I.Logout />Sign out</button>
            </div>
          )}
          <button className="side-user" style={{ width: '100%', background: 'none', border: 0, borderTop: '1px solid #2e2f36', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
            onClick={() => setMenu(menu === 'user' ? null : 'user')} aria-expanded={menu === 'user'} aria-label="Account menu">
            <Avatar name={me.account.name} red />
            <span className="col gap4 grow" style={{ gap: 1 }}>
              <span className="ellipsis" style={{ fontSize: 14, fontWeight: 500, color: '#fff' }}>{me.account.name}</span>
              <span className="ellipsis" style={{ fontSize: 12, color: '#A5A7AE' }}>{roleLabel}</span>
            </span>
            <I.Chevron size={14} style={{ transform: 'rotate(180deg)', color: '#A5A7AE' }} />
          </button>
        </div>
      </nav>
    </>
  );
}

export function Topbar({ crumbs, right }: { crumbs: { label: string; href?: string }[]; right?: ReactNode }) {
  return (
    <header className="topbar no-print">
      <nav aria-label="Breadcrumb" className="crumbs grow">
        {crumbs.map((c, i) => (
          <span key={i} className="row gap6" style={{ minWidth: 0 }}>
            {i > 0 && <span aria-hidden="true">/</span>}
            {c.href && i < crumbs.length - 1 ? <Link href={c.href}>{c.label}</Link> : <span className={i === crumbs.length - 1 ? 'here ellipsis' : 'ellipsis'}>{c.label}</span>}
          </span>
        ))}
      </nav>
      {right}
    </header>
  );
}
