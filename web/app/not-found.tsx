import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="card pad col gap14" style={{ maxWidth: 480 }}>
        <h1 className="page-title" style={{ fontSize: 24 }}>Page not found</h1>
        <p className="muted">The link may be old, or the page may have moved.</p>
        <div><Link href="/" className="btn primary">Go to Lockred</Link></div>
      </div>
    </div>
  );
}
