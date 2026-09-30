'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { ROLE_LABEL } from '@/lib/format';
import { AuthLayout } from '@/components/auth';
import { Loading } from '@/components/ui';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const info = useApi<{ email: string; tenantName: string; role: string; hasAccount: boolean }>(`/auth/invite/${token}`);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfa, setMfa] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mfa) {
        const r = await api.post('/auth/mfa', { code });
        window.location.href = r.next;
        return;
      }
      const r = await api.post(`/auth/invite/${token}`, { name: info.data?.hasAccount ? undefined : name, password });
      if (r.mfaRequired) setMfa(true);
      else window.location.href = r.next;
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      {info.loading && !info.data ? (
        <Loading />
      ) : info.error ? (
        <div className="auth-form">
          <h1>Invitation not valid</h1>
          <p className="muted">{errorText(info.error)} Ask the person who invited you to send a new one.</p>
          <Link href="/login" className="btn block">Go to sign in</Link>
        </div>
      ) : info.data ? (
        <form className="auth-form" onSubmit={submit}>
          <div className="col gap6">
            <h1>Join {info.data.tenantName}</h1>
            <p className="muted">You’re invited as {ROLE_LABEL[info.data.role]?.toLowerCase()} with <strong>{info.data.email}</strong>.</p>
          </div>
          {error && <div className="note bad" role="alert">{error}</div>}
          {mfa ? (
            <label className="field">Code from your authenticator app
              <input className="input mono" inputMode="numeric" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
          ) : info.data.hasAccount ? (
            <label className="field">Your Lockred password
              <input className="input" type="password" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="hint">You already have an account. Sign in to accept.</span>
            </label>
          ) : (
            <>
              <label className="field">Your name<input className="input" required autoFocus autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="field">Choose a password
                <input className="input" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
                <span className="hint">At least 10 characters.</span>
              </label>
            </>
          )}
          <button className="btn primary lg block" disabled={busy}>{mfa ? 'Continue' : 'Accept invitation'}</button>
        </form>
      ) : null}
    </AuthLayout>
  );
}
