'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { AuthLayout } from '@/components/auth';

export default function ResetPage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError('The passwords don’t match');
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={submit}>
        <h1>Choose a password</h1>
        {done ? (
          <>
            <div className="note ok" role="status">Your password is set. You can sign in now.</div>
            <Link href="/login" className="btn primary lg block">Sign in</Link>
          </>
        ) : (
          <>
            {error && <div className="note bad" role="alert">{error}</div>}
            <label className="field">New password
              <input className="input" type="password" autoComplete="new-password" required minLength={10} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="hint">At least 10 characters.</span>
            </label>
            <label className="field">Repeat it
              <input className="input" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
            </label>
            <button className="btn primary lg block" disabled={busy}>Save password</button>
          </>
        )}
      </form>
    </AuthLayout>
  );
}
