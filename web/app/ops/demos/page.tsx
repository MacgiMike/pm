'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { longDate } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { Confirm, Loading, useAction } from '@/components/ui';

export default function OpsDemosPage() {
  const d = useApi<any[]>('/ops/demos');
  const [resetting, setResetting] = useState<any>(null);
  const { run } = useAction();
  return (
    <section className="card">
      <div className="card-head"><h2>Demo portals</h2><span className="small muted">All demos reset automatically on the 1st of every month at 03:00</span></div>
      {!d.data ? <Loading /> : d.data.map((x) => (
        <div key={x.id} className="trow" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1.5fr) 160px 130px' }}>
          <span className="col" style={{ gap: 1 }}><span className="strong">{x.affiliate ? `${x.affiliate.name}’s demo` : 'Public demo'}</span><span className="tiny muted mono">/{x.slug}</span></span>
          <a href={x.entryUrl} target="_blank" rel="noopener noreferrer" className="small mono ellipsis">{x.entryUrl}</a>
          <span className="small muted">Next reset {longDate(x.nextReset)}</span>
          <button className="btn sm" onClick={() => setResetting(x)}>Reset now</button>
        </div>
      ))}
      {resetting && <Confirm title="Reset this demo now?" text="All changes visitors made are thrown away and fresh sample data is loaded. Anyone in it is signed out." confirmLabel="Reset" danger
        onConfirm={() => run(() => api.post(`/ops/demos/${resetting.id}/reset`), 'Demo reset').then(d.reload)} onClose={() => setResetting(null)} />}
    </section>
  );
}
