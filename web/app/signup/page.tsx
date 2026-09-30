'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { AuthLayout } from '@/components/auth';

function slugify(s: string) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export default function SignupPage() {
  const [company, setCompany] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState('pm.lockred.app');
  useEffect(() => setHost(window.location.host), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/auth/signup', { company, slug, name, email, password, acceptTerms: terms });
      window.location.href = r.next;
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={submit} aria-label="Start a free trial">
        <div className="col gap6">
          <h1>Start your free trial</h1>
          <p className="muted">No card needed. Invite your team when you’re ready.</p>
        </div>
        {error && <div className="note bad" role="alert">{error}</div>}
        <label className="field">Organization name
          <input className="input" required value={company} autoFocus onChange={(e) => { setCompany(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} />
        </label>
        <label className="field">Your web address
          <span className="row gap4" style={{ border: '1px solid var(--field)', borderRadius: 8, paddingLeft: 12, background: 'var(--surface)' }}>
            <span className="muted small nowrap">{host}/</span>
            <input className="input" style={{ border: 0, paddingLeft: 2 }} required pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} aria-describedby="slug-hint" />
          </span>
          <span id="slug-hint" className="hint">Lowercase letters, numbers and dashes.</span>
        </label>
        <label className="field">Your name
          <input className="input" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">Work email
          <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">Password
          <input className="input" type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="hint">At least 10 characters.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} required />
          <span>I accept the <Link href="/terms" target="_blank">terms of service</Link></span>
        </label>
        <button className="btn primary lg block" disabled={busy}>{busy ? 'Creating…' : 'Create organization'}</button>
        <p className="small muted">Already have an account? <Link href="/login" className="strong">Sign in</Link></p>
      </form>
    </AuthLayout>
  );
}
