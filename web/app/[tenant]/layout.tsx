'use client';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Me, ProjectHeader, TenantCtx } from '@/lib/context';
import { daysUntil } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { BrandMark, I } from '@/components/icons';
import { PlainLayout, SignOutButton } from '@/components/plain';
import { Sidebar } from '@/components/shell';
import { Loading } from '@/components/ui';

export default function TenantLayout({ children }: { children: ReactNode }) {
  const { tenant: slug } = useParams<{ tenant: string }>();
  const path = usePathname();
  const me = useApi<Me>('/auth/me');
  const [switching, setSwitching] = useState(false);
  const [notMember, setNotMember] = useState(false);
  const [project, setProject] = useState<ProjectHeader | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const myTasks = useApi<any[]>(me.data?.tenant?.slug === slug && me.data?.tenant?.usable ? '/me/tasks' : null);

  // Keep the session's organization in sync with the URL.
  useEffect(() => {
    const m = me.data;
    if (!m || switching) return;
    if (m.tenant?.slug === slug) return;
    if (!m.tenants.some((t) => t.slug === slug)) {
      setNotMember(true);
      return;
    }
    setSwitching(true);
    api.post('/auth/switch', { slug }).then(() => me.reload()).finally(() => setSwitching(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data, slug, switching]);

  useEffect(() => {
    if (!path.includes('/p/')) setProject(null);
  }, [path]);

  const ctx = useMemo(
    () => (me.data && me.data.tenant ? { me: me.data, slug, base: `/${slug}`, reloadMe: me.reload, project, setProject } : null),
    [me.data, me.reload, slug, project],
  );

  if (notMember) {
    return (
      <PlainLayout right={<SignOutButton />}>
        <div className="card pad col gap14">
          <h1 className="page-title" style={{ fontSize: 22 }}>You don’t have access to this organization</h1>
          <p className="muted">Ask one of its admins to invite you, or pick one of your own organizations.</p>
          <div><Link href="/select" className="btn primary">Your organizations</Link></div>
        </div>
      </PlainLayout>
    );
  }
  if (!ctx || ctx.me.tenant!.slug !== slug) return <Loading />;

  const t = ctx.me.tenant!;
  const base = `/${slug}`;
  const billingPaths = [`${base}/billing`, `${base}/support`, `${base}/admin`];
  const onAllowedPage = billingPaths.some((p) => path.startsWith(p));
  const trialDays = t.status === 'TRIAL' ? daysUntil(t.trialEndsAt?.slice(0, 10)) : null;

  return (
    <TenantCtx.Provider value={ctx}>
      <div className="shell">
        <Sidebar me={ctx.me} base={base} project={project} myTaskCount={myTasks.data?.filter((x) => x.progress < 100).length} open={menuOpen} onClose={() => setMenuOpen(false)} />
        <div className="main">
          <div className="mobile-bar">
            <button onClick={() => setMenuOpen(true)} aria-label="Open menu"><I.Menu size={22} /></button>
            <BrandMark size={26} />
            <span className="ellipsis" style={{ fontWeight: 600 }}>{project?.name ?? t.name}</span>
          </div>
          {ctx.me.tenant!.mfaSetupRequired && (
            <div className="note warn no-print" style={{ borderRadius: 0 }}>
              Your organization requires 2-step sign-in for admins. <Link href="/account" className="strong">Set it up now</Link>
            </div>
          )}
          {trialDays !== null && trialDays <= 7 && trialDays >= 0 && t.role === 'ADMIN' && (
            <div className="note warn no-print" style={{ borderRadius: 0 }}>
              Your free trial ends {trialDays === 0 ? 'today' : `in ${trialDays} day${trialDays === 1 ? '' : 's'}`}. <Link href={`${base}/billing`} className="strong">Choose a plan</Link>
            </div>
          )}
          {t.status === 'PAST_DUE' && t.role === 'ADMIN' && (
            <div className="note bad no-print" style={{ borderRadius: 0 }}>
              We couldn’t take the last payment. <Link href={`${base}/billing`} className="strong">Update your payment method</Link> to avoid interruption.
            </div>
          )}
          {!t.usable && !onAllowedPage ? (
            <div className="page">
              <div className="card pad col gap14" style={{ maxWidth: 640 }}>
                <h1 className="page-title" style={{ fontSize: 22 }}>{t.status === 'TRIAL' ? 'Your free trial has ended' : 'This organization is paused'}</h1>
                <p className="muted">
                  {t.role === 'ADMIN'
                    ? 'Your projects are safe. Choose a plan to keep working — everything will be exactly where you left it.'
                    : 'Your projects are safe. Ask an admin in your organization to choose a plan.'}
                </p>
                <div className="row gap8">
                  {t.role === 'ADMIN' && <Link href={`${base}/billing`} className="btn primary">Choose a plan</Link>}
                  <Link href={`${base}/support`} className="btn">Contact support</Link>
                </div>
              </div>
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </TenantCtx.Provider>
  );
}
