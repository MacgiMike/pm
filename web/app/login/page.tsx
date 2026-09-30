'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { AuthLayout, nextParam } from '@/components/auth';

export default function LoginPage() {
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const go = (next: string) => {
    window.location.href = nextParam() ?? next;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (step === 'password') {
        const r = await api.post('/auth/login', { email, password });
        if (r.mfaRequired) setStep('code');
        else go(r.next);
      } else {
        const r = await api.post('/auth/mfa', { code });
        go(r.next);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={submit} aria-label="Sign in">
        {step === 'password' ? (
          <>
            <div className="col gap6">
              <h1>Sign in</h1>
              <p className="muted">Welcome back.</p>
            </div>
            {error && <div className="note bad" role="alert">{error}</div>}
            <label className="field">Work email
              <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span className="row between">Password<Link href="/forgot" className="small muted" style={{ fontWeight: 400 }}>Forgot password?</Link></span>
              <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button className="btn primary lg block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <div className="note">Got a link to a task? Just open it — external collaborators don’t need an account.</div>
            <p className="small muted">New to Lockred? <Link href="/signup" className="strong">Start a free trial</Link> or <Link href="/demo" className="strong">try the live demo</Link></p>
          </>
        ) : (
          <>
            <div className="col gap6">
              <h1>2-step sign-in</h1>
              <p className="muted">Enter the 6-digit code from your authenticator app.</p>
            </div>
            {error && <div className="note bad" role="alert">{error}</div>}
            <label className="field">Code
              <input className="input mono" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" required value={code}
                onChange={(e) => setCode(e.target.value)} autoFocus style={{ fontSize: 22, letterSpacing: '0.2em', textAlign: 'center' }} />
            </label>
            <button className="btn primary lg block" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
            <button type="button" className="btn ghost" onClick={() => { setStep('password'); setCode(''); setError(''); }}>Use a different account</button>
          </>
        )}
      </form>
    </AuthLayout>
  );
}
