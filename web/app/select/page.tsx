'use client';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { ROLE_LABEL } from '@/lib/format';
import { Me } from '@/lib/context';
import { PlainLayout, SignOutButton } from '@/components/plain';
import { Empty, Loading } from '@/components/ui';
import { I } from '@/components/icons';

export default function SelectPage() {
  const me = useApi<Me>('/auth/me');
  const open = async (slug: string) => {
    await api.post('/auth/switch', { slug });
    window.location.href = `/${slug}`;
  };
  return (
    <PlainLayout right={<SignOutButton />}>
      <h1 className="page-title">Choose an organization</h1>
      {!me.data ? (
        <Loading />
      ) : (
        <div className="card">
          {me.data.tenants.length === 0 ? (
            <Empty title="You’re not in any organization yet" action={<Link href="/signup" className="btn primary">Start a free trial</Link>}>
              If someone invited you, open the link in the invitation email.
            </Empty>
          ) : (
            me.data.tenants.map((t) => (
              <button key={t.id} className="trow" onClick={() => open(t.slug)}
                style={{ gridTemplateColumns: '40px minmax(0,1fr) auto 20px', width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer' }}>
                <span style={{ width: 36, height: 36, borderRadius: 9, background: '#3B5BA9', color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.name[0]}</span>
                <span className="col gap4" style={{ gap: 1 }}><strong>{t.name}</strong><span className="small muted">{ROLE_LABEL[t.role]}{t.isDemo ? ' · demo' : ''}</span></span>
                <span />
                <I.ChevronRight />
              </button>
            ))
          )}
        </div>
      )}
      {me.data && (
        <div className="row wrap gap8">
          {me.data.account.isOperator && <Link href="/ops" className="btn"><I.Shield />Operator console</Link>}
          {me.data.affiliate && <Link href="/partners" className="btn"><I.Gift />Partner portal</Link>}
          <Link href="/account" className="btn"><I.User />Your account</Link>
        </div>
      )}
    </PlainLayout>
  );
}
