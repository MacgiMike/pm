'use client';
import Link from 'next/link';
import { ReactNode } from 'react';
import { BrandMark } from './icons';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-side" aria-hidden="true">
        <Link href="/" className="brand" style={{ color: '#fff' }}><BrandMark size={36} /><span className="brand-name" style={{ fontSize: 22 }}>Lockred</span></Link>
        <div className="col" style={{ flex: 1, justifyContent: 'center', gap: 28 }}>
          <h2 className="display" style={{ fontSize: 46, lineHeight: 1.08, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
            Every project,<br />one clear picture.
          </h2>
          <div className="col gap16" style={{ fontSize: 16, lineHeight: 1.5, color: '#C4C3BE' }}>
            {[
              'Set directives and KPIs before the first task is written.',
              'Tasks roll up into swim lanes, lanes into the project, projects into the portfolio.',
              'Every invoice lands on a budget post, so you always know what is left.',
            ].map((t, i) => (
              <div key={i} className="row top gap14">
                <span className="mono" style={{ color: '#E5A19E', fontSize: 14, paddingTop: 2 }}>0{i + 1}</span>
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 13, color: '#8E9098' }}>Lockred Projects · Hosted in the EU</div>
      </section>
      <main className="auth-main">{children}</main>
    </div>
  );
}

export function nextParam(): string | null {
  if (typeof window === 'undefined') return null;
  const n = new URLSearchParams(window.location.search).get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : null;
}
