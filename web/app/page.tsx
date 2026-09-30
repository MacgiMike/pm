'use client';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { Loading } from '@/components/ui';

/** Entry point: referral links (?ref=code) and "where should I go?" after sign-in. */
export default function Home() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref && /^[a-z0-9-]{3,30}$/.test(ref)) {
      window.location.replace(`/api/r/${ref}?to=/signup`);
      return;
    }
    api
      .get('/auth/me')
      .then((me) => {
        if (me.tenant) window.location.replace(`/${me.tenant.slug}`);
        else if (me.tenants.length) window.location.replace('/select');
        else if (me.account.isOperator) window.location.replace('/ops');
        else if (me.affiliate) window.location.replace('/partners');
        else window.location.replace('/select');
      })
      .catch(() => window.location.replace('/login'));
  }, []);
  return <Loading />;
}
