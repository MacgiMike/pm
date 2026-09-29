import { TenantSettings } from '../core/context';

export interface TaskLite {
  id?: string;
  laneId: string | null;
  progress: number;
  estimateHours: number | null;
  startDate: Date | null;
  dueDate: Date | null;
}

export type Health = 'ON_TRACK' | 'AT_RISK' | 'BEHIND';

const DAY = 86_400_000;

export const weight = (t: TaskLite) => (t.estimateHours && t.estimateHours > 0 ? t.estimateHours : 1);

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Weighted by estimated hours; a task without an estimate counts as 1 hour. */
export function actualProgress(tasks: TaskLite[]): number {
  const w = tasks.reduce((s, t) => s + weight(t), 0);
  if (!w) return 0;
  return round1(tasks.reduce((s, t) => s + t.progress * weight(t), 0) / w);
}

/** Where a task should be on `day`, assuming even progress between start and due. */
export function expectedAt(t: TaskLite, day: Date, projectStart: Date): number | null {
  if (!t.dueDate) return null;
  const start = (t.startDate ?? projectStart).getTime();
  const end = t.dueDate.getTime() + DAY; // due date is inclusive
  if (end <= start) return day.getTime() >= end ? 100 : 0;
  const f = (day.getTime() - start) / (end - start);
  return Math.max(0, Math.min(100, f * 100));
}

/** Planned progress on `day`. Tasks without a due date count at their actual progress (no variance). */
export function plannedProgress(tasks: TaskLite[], day: Date, projectStart: Date): number {
  const w = tasks.reduce((s, t) => s + weight(t), 0);
  if (!w) return 0;
  return round1(
    tasks.reduce((s, t) => {
      const e = expectedAt(t, day, projectStart);
      return s + (e === null ? t.progress : e) * weight(t);
    }, 0) / w,
  );
}

export function isLate(t: TaskLite, day: Date): boolean {
  return !!t.dueDate && t.progress < 100 && t.dueDate.getTime() < day.getTime();
}

/** Forecast at completion if the remaining work costs what was planned. */
export function forecast(spent: number, budget: number, progress: number): number {
  if (budget <= 0) return spent;
  return Math.round(spent + budget * (1 - Math.min(100, progress) / 100));
}

export interface Summary {
  progress: number;
  planned: number;
  gap: number;
  budget: number;
  spent: number;
  forecast: number;
  health: Health;
  reasons: string[];
  lateTasks: number;
}

export function summarize(
  p: { startDate: Date; approvedBudget: number },
  tasks: TaskLite[],
  spent: number,
  postsTotal: number,
  settings: TenantSettings,
  day: Date,
): Summary {
  const progress = actualProgress(tasks);
  const planned = plannedProgress(tasks, day, p.startDate);
  const gap = round1(planned - progress);
  const budget = p.approvedBudget > 0 ? p.approvedBudget : postsTotal;
  const fc = forecast(spent, budget, progress);
  const reasons: string[] = [];
  let health: Health = 'ON_TRACK';
  const bump = (h: Health) => {
    if (h === 'BEHIND' || (h === 'AT_RISK' && health === 'ON_TRACK')) health = h;
  };
  if (gap > settings.behindThreshold) {
    bump('BEHIND');
    reasons.push(`${Math.round(gap)} pts behind plan`);
  } else if (gap > settings.riskThreshold) {
    bump('AT_RISK');
    reasons.push(`${Math.round(gap)} pts behind plan`);
  }
  if (budget > 0 && spent > budget) {
    bump('BEHIND');
    reasons.push(`${Math.round((spent / budget - 1) * 100)}% over budget`);
  } else if (budget > 0 && fc > budget) {
    bump('AT_RISK');
    reasons.push('forecast over budget');
  }
  return {
    progress,
    planned,
    gap,
    budget,
    spent,
    forecast: fc,
    health,
    reasons,
    lateTasks: tasks.filter((t) => isLate(t, day)).length,
  };
}

/** Month-end dates from start to end (inclusive), for S-curves. */
export function monthPoints(start: Date, end: Date): Date[] {
  const out: Date[] = [start];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (;;) {
    const monthEnd = new Date(Date.UTC(y, m + 1, 0));
    if (monthEnd.getTime() >= end.getTime()) break;
    if (monthEnd.getTime() > start.getTime()) out.push(monthEnd);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  out.push(end);
  return out;
}
