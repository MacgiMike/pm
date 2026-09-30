'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ReactNode, useEffect, useMemo } from 'react';
import { ProjectCtx, useTenant } from '@/lib/context';
import { useApi } from '@/lib/useApi';
import { ApiError } from '@/lib/api';
import { I } from '@/components/icons';
import { ErrorBox, Loading } from '@/components/ui';

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const { base, setProject, me } = useTenant();
  const p = useApi<any>(`/projects/${id}`);

  useEffect(() => {
    if (p.data) {
      setProject({
        id: p.data.id, name: p.data.name, role: p.data.role, can: p.data.can,
        health: p.data.summary.health, owner: p.data.owner, archived: p.data.archived,
      });
    }
  }, [p.data, setProject]);

  const value = useMemo(() => (p.data ? { id, header: { id: p.data.id, name: p.data.name, role: p.data.role, can: p.data.can, health: p.data.summary.health, owner: p.data.owner, archived: p.data.archived }, data: p.data, reload: p.reload, base: `${base}/p/${id}` } : null), [p.data, p.reload, id, base]);

  if (p.error) {
    const notFound = p.error instanceof ApiError && p.error.status === 404;
    return (
      <div className="page">
        {notFound ? (
          <div className="card pad col gap14" style={{ maxWidth: 620 }}>
            <h1 className="page-title" style={{ fontSize: 22 }}>Project not found</h1>
            <p className="muted">Either it doesn’t exist or you haven’t been given access. Projects are private — ask the project owner to add you.</p>
            <div><Link href={base} className="btn">Back to {me.tenant!.role === 'MEMBER' ? 'your projects' : 'the portfolio'}</Link></div>
          </div>
        ) : <ErrorBox error={p.error} retry={p.reload} />}
      </div>
    );
  }
  if (!value) return <Loading />;

  return (
    <ProjectCtx.Provider value={value}>
      {value.header.role === 'VIEWER' && (
        <div className="note info row no-print" role="note" style={{ borderRadius: 0, gap: 12, padding: '10px 32px' }}>
          <I.Eye size={18} />
          <span className="grow">
            You’re viewing as {me.tenant!.role === 'ADMIN' ? 'an admin' : 'a portfolio manager'}. Everything here is read-only — only the owner{value.header.owner ? `, ${value.header.owner.name},` : ''} and the team can change this project.
          </span>
          {value.header.can.changeOwner && <Link href={base} className="strong" style={{ color: 'var(--blue-ink)' }}>Change owner</Link>}
        </div>
      )}
      {value.header.archived && (
        <div className="note warn no-print" style={{ borderRadius: 0, padding: '10px 32px' }}>This project is archived. It’s hidden from the portfolio and reports.</div>
      )}
      {children}
    </ProjectCtx.Provider>
  );
}
