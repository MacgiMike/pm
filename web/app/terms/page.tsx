import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms of service' };

const ACK: [string, string, string][] = [
  ['Next.js, React, React DOM', 'MIT', 'Vercel, Inc. / Meta Platforms, Inc.'],
  ['NestJS (@nestjs/*)', 'MIT', 'Kamil Myśliwiec'],
  ['Prisma ORM', 'Apache-2.0', 'Prisma Data, Inc.'],
  ['PostgreSQL (server)', 'PostgreSQL License', 'The PostgreSQL Global Development Group'],
  ['Stripe Node.js library', 'MIT', 'Stripe, Inc.'],
  ['argon2 (node-argon2)', 'MIT', 'Ranieri Althoff'],
  ['otplib', 'MIT', 'Gerald Yeo'],
  ['qrcode', 'MIT', 'Ryan Day'],
  ['Nodemailer', 'MIT-0', 'Andris Reinman'],
  ['Zod', 'MIT', 'Colin McDonnell'],
  ['RxJS', 'Apache-2.0', 'Google, Inc., Netflix, Inc., Microsoft Corp. and contributors'],
  ['Express, cookie-parser, multer', 'MIT', 'OpenJS Foundation and contributors'],
  ['reflect-metadata', 'Apache-2.0', 'Microsoft Corporation'],
  ['IBM Plex Sans / IBM Plex Mono fonts', 'SIL Open Font License 1.1', 'IBM Corp.'],
  ['Schibsted Grotesk font', 'SIL Open Font License 1.1', 'Schibsted Media Group'],
  ['Fontsource packaging', 'MIT', 'Fontsource contributors'],
  ['Node.js runtime', 'MIT', 'OpenJS Foundation and contributors'],
];

export default function TermsPage() {
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 20px 64px', display: 'flex', flexDirection: 'column', gap: 18, lineHeight: 1.6 }}>
      <Link href="/" className="small muted">← Lockred</Link>
      <h1 className="page-title">Terms of service</h1>
      <div className="note warn">Template — replace the bracketed parts and have it reviewed by a lawyer before launch.</div>
      <p>These terms apply between [COMPANY NAME], org. no. [ORG NUMBER] (“Lockred”, “we”) and the organization that signs up for Lockred Projects (“Customer”).</p>
      <h2 style={{ fontSize: 18 }}>1. The service</h2>
      <p>Lockred Projects is a hosted project management service. We provide it on a subscription basis as described on the pricing page at the time of purchase. Trials are free for the trial period and end automatically unless a paid plan is chosen.</p>
      <h2 style={{ fontSize: 18 }}>2. Your data</h2>
      <p>The Customer owns all content it puts into the service. We process personal data on the Customer’s behalf as a processor under the data processing agreement at [DPA LINK]. Data is stored in [HOSTING LOCATION, e.g. the EU]. The Customer can export its data at any time from Admin → Data export. After cancellation we keep the data for 30 days, then delete it.</p>
      <h2 style={{ fontSize: 18 }}>3. Task links</h2>
      <p>Project owners can share a single task with people outside the organization through a private link. Anyone holding the link can open that task until it expires or is revoked. The Customer is responsible for who it shares links with.</p>
      <h2 style={{ fontSize: 18 }}>4. Payment</h2>
      <p>Paid plans are billed in advance per seat through Stripe. Seat changes are prorated. If a payment fails we will retry and notify the Customer’s admins; the service may be suspended if payment is not received within [NUMBER] days.</p>
      <h2 style={{ fontSize: 18 }}>5. Acceptable use, liability and termination</h2>
      <p>[ADD YOUR TERMS ON ACCEPTABLE USE, AVAILABILITY, LIMITATION OF LIABILITY, TERMINATION, GOVERNING LAW (e.g. Swedish law) AND DISPUTE RESOLUTION.]</p>
      <h2 style={{ fontSize: 18 }}>6. Affiliate program</h2>
      <p>Partners in the Lockred affiliate program earn a commission on payments from customers they refer, as agreed in their partner terms. Commission is paid through Stripe Connect.</p>
      <h2 id="acknowledgments" style={{ fontSize: 18 }}>7. Open-source acknowledgments</h2>
      <p>Lockred Projects is built with the following open-source software. All of it is used under permissive licenses; no copyleft license applies to the service. We thank the authors.</p>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}><th style={{ padding: '10px 16px' }}>Component</th><th style={{ padding: '10px 16px' }}>License</th><th style={{ padding: '10px 16px' }}>Copyright</th></tr></thead>
          <tbody>
            {ACK.map(([c, l, o]) => (
              <tr key={c} style={{ borderTop: '1px solid var(--line)' }}><td style={{ padding: '8px 16px' }}>{c}</td><td style={{ padding: '8px 16px' }}>{l}</td><td style={{ padding: '8px 16px' }}>{o}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">Full license texts are included in the software distribution (THIRD_PARTY_NOTICES.md) and in each package’s LICENSE file.</p>
    </div>
  );
}
