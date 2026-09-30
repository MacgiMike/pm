'use client';
import Link from 'next/link';
import { ReactNode } from 'react';
import { BrandMark } from './icons';
import { logout } from './ui';

/** Simple page frame for screens outside an organization (account, org picker, partner portal, legal). */
export function PlainLayout({ children, right, wide }: { children: ReactNode; right?: ReactNode; wide?: boolean }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="row" style={{ minHeight: 64, padding: '0 clamp(16px, 4vw, 40px)', background: 'var(--surface)', borderBottom: '1px solid var(--border)', gap: 14 }}>
        <Link href="/" className="brand" style={{ color: 'var(--ink)', padding: 0 }}><BrandMark /><span className="brand-name">Lockred</span></Link>
        <span className="grow" />
        {right}
      </header>
      <main style={{ flex: 1, padding: '32px clamp(16px, 4vw, 40px) 48px', width: '100%', maxWidth: wide ? 1320 : 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {children}
      </main>
    </div>
  );
}

export function SignOutButton() {
  return <button className="btn sm" onClick={logout}>Sign out</button>;
}
