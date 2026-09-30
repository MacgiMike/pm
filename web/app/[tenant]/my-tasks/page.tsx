'use client';
import Link from 'next/link';
import { useTenant } from '@/lib/context';
import { pct, relDays, shortDate } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { Topbar } from '@/components/shell';
import { Bar, Empty, ErrorBox, Loading } from '@/components/ui';

interface MyTask { id: string; title: string; progress: number; dueDate: string | null; late: boolean; project: { id: string; name: string }; lane: { name: string; color: string } | null }

export default function MyTasksPage() {
  const { me, base } = useTenant();
  const tasks = useApi<MyTask[]>('/me/tasks');
  const open = (tasks.data ?? []).filter((t) => t.progress < 100);
  const done = (tasks.data ?? []).filter((t) => t.progress === 100);
  const Row = ({ t }: { t: MyTask }) => (
    <Link href={`${base}/p/${t.project.id}/tasks/${t.id}`} className="trow" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1.3fr) 140px minmax(120px,1fr)' }}>
      <span className="col" style={{ gap: 2, minWidth: 0 }}>
        <span className="strong ellipsis">{t.title}</span>
        {t.lane && <span className="tiny muted row gap6"><span className="dot" style={{ background: t.lane.color }} />{t.lane.name}</span>}
      </span>
      <span className="ellipsis" style={{ color: 'var(--text2)' }}>{t.project.name}</span>
      <span className={t.late ? 'txt-bad strong small' : 'small muted'}>{t.dueDate ? `${shortDate(t.dueDate)} · ${relDays(t.dueDate)}` : 'No due date'}</span>
      <span className="row gap8"><span className="grow"><Bar value={t.progress} size="thin" /></span><span className="mono tiny" style={{ width: 36, textAlign: 'right' }}>{pct(t.progress)}</span></span>
    </Link>
  );
  return (
    <>
      <Topbar crumbs={[{ label: me.tenant!.name, href: base }, { label: 'My tasks' }]} />
      <div className="page">
        <div className="col gap4">
          <h1 className="page-title">My tasks</h1>
          <p className="small muted">Everything assigned to you, soonest first.</p>
        </div>
        {tasks.error && <ErrorBox error={tasks.error} retry={tasks.reload} />}
        {!tasks.data && !tasks.error && <Loading />}
        {tasks.data && (
          <section className="card">
            {open.length === 0 ? (
              <Empty title="Nothing on your plate">When someone assigns a task to you, it shows up here.</Empty>
            ) : open.map((t) => <Row key={t.id} t={t} />)}
          </section>
        )}
        {done.length > 0 && (
          <details className="card">
            <summary style={{ padding: '14px 20px', cursor: 'pointer', fontWeight: 600 }}>Done ({done.length})</summary>
            {done.map((t) => <Row key={t.id} t={t} />)}
          </details>
        )}
      </div>
    </>
  );
}
