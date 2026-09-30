'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { Me } from '@/lib/context';
import { PlainLayout, SignOutButton } from '@/components/plain';
import { Loading, useAction } from '@/components/ui';

export default function AccountPage() {
  const me = useApi<Me>('/auth/me');
  const { busy, run } = useAction();
  const [name, setName] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');

  if (!me.data) return <PlainLayout><Loading /></PlainLayout>;
  const a = me.data.account;
  const back = me.data.tenant ? `/${me.data.tenant.slug}` : '/select';

  const saveName = (e: FormEvent) => {
    e.preventDefault();
    run(() => api.patch('/auth/profile', { name: name ?? a.name }), 'Name saved').then(() => me.reload());
  };
  const savePw = (e: FormEvent) => {
    e.preventDefault();
    run(() => api.post('/auth/password', pw), 'Password changed. Other devices were signed out.').then((r) => r && setPw({ current: '', next: '' }));
  };
  const startMfa = () => run(() => api.post('/auth/mfa/setup')).then((r) => r && setSetup(r));
  const enableMfa = (e: FormEvent) => {
    e.preventDefault();
    run(() => api.post('/auth/mfa/enable', { code }), '2-step sign-in is on').then((r) => {
      if (r) { setSetup(null); setCode(''); me.reload(); }
    });
  };
  const disableMfa = (e: FormEvent) => {
    e.preventDefault();
    run(() => api.post('/auth/mfa/disable', { code }), '2-step sign-in is off').then((r) => {
      if (r) { setCode(''); me.reload(); }
    });
  };

  return (
    <PlainLayout right={<><Link href={back} className="btn sm">Back</Link><SignOutButton /></>}>
      <h1 className="page-title">Your account</h1>
      {(me.data.operatorMfaSetupRequired || me.data.tenant?.mfaSetupRequired) && !a.totpEnabled && (
        <div className="note warn" role="alert">Your role requires 2-step sign-in. Set it up below to continue.</div>
      )}

      <form className="card pad col gap14" onSubmit={saveName}>
        <h2 style={{ fontSize: 16 }}>Profile</h2>
        <div className="grid g2">
          <label className="field">Name<input className="input" required value={name ?? a.name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field">Email<input className="input" value={a.email} disabled /></label>
        </div>
        <div><button className="btn" disabled={busy}>Save</button></div>
      </form>

      <form className="card pad col gap14" onSubmit={savePw}>
        <h2 style={{ fontSize: 16 }}>Password</h2>
        <div className="grid g2">
          <label className="field">Current password<input className="input" type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
          <label className="field">New password<input className="input" type="password" autoComplete="new-password" minLength={10} required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
        </div>
        <div><button className="btn" disabled={busy}>Change password</button></div>
      </form>

      <section className="card pad col gap14">
        <div className="row between">
          <h2 style={{ fontSize: 16 }}>2-step sign-in</h2>
          <span className={`badge ${a.totpEnabled ? 'ok' : 'neutral'}`}>{a.totpEnabled ? 'On' : 'Off'}</span>
        </div>
        <p className="muted small">Use an authenticator app such as Microsoft Authenticator, Google Authenticator or 1Password. You’ll enter a 6-digit code when you sign in.</p>
        {a.totpEnabled ? (
          <form className="row wrap gap8" onSubmit={disableMfa}>
            <input className="input sm mono" style={{ maxWidth: 160 }} placeholder="123456" inputMode="numeric" aria-label="Current code" value={code} onChange={(e) => setCode(e.target.value)} required />
            <button className="btn danger sm" disabled={busy}>Turn off</button>
          </form>
        ) : setup ? (
          <form className="row top wrap gap20" onSubmit={enableMfa}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} style={{ border: '1px solid var(--border)', borderRadius: 10 }} />
            <div className="col gap8" style={{ maxWidth: 360 }}>
              <span className="small">1. Scan the code with your app. Can’t scan? Enter this key:</span>
              <code className="mono small" style={{ wordBreak: 'break-all', background: 'var(--bg)', padding: '6px 8px', borderRadius: 6 }}>{setup.secret}</code>
              <span className="small">2. Type the 6-digit code it shows:</span>
              <div className="row gap8">
                <input className="input sm mono" style={{ maxWidth: 160 }} inputMode="numeric" aria-label="Code from app" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
                <button className="btn primary sm" disabled={busy}>Turn on</button>
              </div>
            </div>
          </form>
        ) : (
          <div><button className="btn primary" onClick={startMfa} disabled={busy}>Set up 2-step sign-in</button></div>
        )}
      </section>
    </PlainLayout>
  );
}
