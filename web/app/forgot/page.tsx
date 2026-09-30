'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { AuthLayout } from '@/components/auth';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/forgot', { email });
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={submit}>
        <h1>Reset your password</h1>
        {sent ? (
          <>
            <div className="note ok" role="status">If there’s an account for {email}, we’ve sent a link to choose a new password. It works for 1 hour.</div>
            <Link href="/login" className="btn block">Back to sign in</Link>
          </>
        ) : (
          <>
            <p className="muted">We’ll email you a link.</p>
            {error && <div className="note bad" role="alert">{error}</div>}
            <label className="field">Email<input className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <button className="btn primary lg block" disabled={busy}>Send link</button>
            <Link href="/login" className="small muted">Back to sign in</Link>
          </>
        )}
      </form>
    </AuthLayout>
  );
}
