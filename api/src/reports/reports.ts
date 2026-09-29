import { Controller, Get, Header, Injectable, Logger, Param, UseGuards } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { config } from '../config';
import { Ctx, readSettings } from '../core/context';
import { CurrentCtx, TenantGuard } from '../core/guards';
import { MailService } from '../core/mail.service';
import { PrismaService, Tx } from '../core/prisma.service';
import { num, todayUtc, ymd } from '../core/util';
import { AccessService } from '../projects/access.service';
import { actualProgress, isLate, monthPoints, plannedProgress, summarize } from '../projects/metrics';
import { kpiOut, ProjectsService, toLite } from '../projects/projects.service';

const csvEsc = (v: unknown) => {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: unknown[][]) => '﻿' + rows.map((r) => r.map(csvEsc).join(';')).join('\r\n');

@Injectable()
export class ReportsService {
  private readonly log = new Logger('Reports');
  constructor(
    private prisma: PrismaService,
    private access: AccessService,
    private projects: ProjectsService,
    private mail: MailService,
  ) {}

  async portfolio(ctx: Ctx) {
    const rows = await this.projects.portfolio(ctx);
    const withBudget = rows.filter((r) => r.budget !== null);
    return {
      generatedAt: new Date(),
      thresholds: { risk: ctx.tenant!.settings.riskThreshold, behind: ctx.tenant!.settings.behindThreshold },
      totals: {
        projects: rows.length,
        onTrack: rows.filter((r) => r.health === 'ON_TRACK').length,
        atRisk: rows.filter((r) => r.health === 'AT_RISK').length,
        behind: rows.filter((r) => r.health === 'BEHIND').length,
        behindSchedule: rows.filter((r) => r.gap > ctx.tenant!.settings.riskThreshold).length,
        overBudget: withBudget.filter((r) => r.budget! > 0 && r.spent! > r.budget!).length,
        budget: withBudget.reduce((s, r) => s + (r.budget ?? 0), 0),
        spent: withBudget.reduce((s, r) => s + (r.spent ?? 0), 0),
        currency: ctx.tenant!.currency,
      },
      rows,
    };
  }

  async portfolioCsv(ctx: Ctx) {
    const p = await this.portfolio(ctx);
    return toCsv([
      ['Project', 'Owner', 'Health', 'Progress %', 'Planned %', 'Variance pts', 'Budget', 'Spent', 'Forecast', 'Next tollgate', 'Tollgate date', 'Late tasks', 'Start', 'End'],
      ...p.rows.map((r) => [
        r.name, r.owner?.name ?? '', r.health, r.progress, r.planned, -r.gap, r.budget ?? '', r.spent ?? '', r.forecast ?? '',
        r.nextTollgate ? `${r.nextTollgate.code} ${r.nextTollgate.name}` : '', r.nextTollgate?.date ?? '', r.lateTasks, r.startDate, r.endDate,
      ]),
    ]);
  }

  async project(ctx: Ctx, id: string) {
    return this.prisma.tenant(ctx.tenantId!, async (tx) => {
      const a = await this.access.project(tx, ctx, id);
      const p = a.project;
      const today = todayUtc();
      const [tasks, lanes, gates, kpis, posts, costs, snapshots, owner, recent] = await Promise.all([
        tx.task.findMany({ where: { projectId: id }, include: { lane: { select: { name: true } } }, orderBy: [{ dueDate: 'asc' }] }),
        tx.lane.findMany({ where: { projectId: id }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
        tx.tollgate.findMany({ where: { projectId: id }, orderBy: [{ date: 'asc' }, { sort: 'asc' }], include: { criteria: true } }),
        tx.kpi.findMany({ where: { projectId: id }, orderBy: [{ sort: 'asc' }], include: { values: { orderBy: { measuredAt: 'desc' }, take: 12 } } }),
        tx.budgetPost.findMany({ where: { projectId: id }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
        tx.cost.findMany({ where: { projectId: id }, select: { budgetPostId: true, amount: true, date: true } }),
        tx.projectSnapshot.findMany({ where: { projectId: id }, orderBy: { date: 'asc' } }),
        tx.projectMember.findFirst({ where: { projectId: id, role: 'OWNER' }, include: { account: { select: { name: true } } } }),
        tx.activity.count({ where: { projectId: id, createdAt: { gt: new Date(Date.now() - 7 * 86_400_000) } } }),
      ]);
      const lite = tasks.map(toLite);
      const spent = costs.reduce((s, c) => s + num(c.amount), 0);
      const allocated = posts.reduce((s, x) => s + num(x.amount), 0);
      const s = summarize({ startDate: p.startDate, approvedBudget: num(p.approvedBudget) }, lite, spent, allocated, ctx.tenant!.settings, today);

      // S-curve: planned at each month end; actual from nightly snapshots (and today).
      const points = monthPoints(p.startDate, p.endDate);
      const curve = points.map((d) => {
        const snap = [...snapshots].reverse().find((x) => x.date.getTime() <= d.getTime());
        const isPast = d.getTime() <= today.getTime();
        return {
          date: ymd(d),
          planned: plannedProgress(lite, d, p.startDate),
          actual: isPast ? (snap ? num(snap.progress) : d.getTime() === p.startDate.getTime() ? 0 : null) : null,
        };
      });
      if (today >= p.startDate && today <= p.endDate) {
        curve.push({ date: ymd(today), planned: s.planned, actual: s.progress });
        curve.sort((x, y) => x.date!.localeCompare(y.date!));
      }

      const spentBy = new Map<string, number>();
      for (const c of costs) spentBy.set(c.budgetPostId, (spentBy.get(c.budgetPostId) ?? 0) + num(c.amount));
      const kpiRows = kpis.map(kpiOut);

      return {
        generatedAt: new Date(),
        project: { id: p.id, name: p.name, purpose: p.purpose, owner: owner?.account.name ?? null, startDate: ymd(p.startDate), endDate: ymd(p.endDate) },
        tenantName: ctx.tenant!.name,
        currency: ctx.tenant!.currency,
        can: a.can,
        summary: {
          health: s.health,
          reasons: a.can.budgetView ? s.reasons : s.reasons.filter((r) => !r.includes('budget')),
          progress: s.progress,
          planned: s.planned,
          gap: s.gap,
          lateTasks: s.lateTasks,
          changesLast7Days: recent,
          kpisOnTarget: kpiRows.filter((k) => k.status === 'ON_TARGET').length,
          kpisMeasured: kpiRows.filter((k) => k.status !== 'NO_DATA').length,
          kpisTotal: kpiRows.length,
        },
        curve,
        lanes: lanes.map((l) => {
          const lt = lite.filter((t) => t.laneId === l.id);
          return { name: l.name, color: l.color, progress: actualProgress(lt), planned: plannedProgress(lt, today, p.startDate) };
        }),
        tollgates: gates.map((g) => ({
          code: g.code,
          name: g.name,
          date: ymd(g.date),
          passed: !!g.passedAt,
          met: g.criteria.filter((c) => c.met).length,
          total: g.criteria.length,
          openTasks: tasks.filter((t) => t.tollgateId === g.id && t.progress < 100).length,
        })),
        kpis: kpiRows,
        lateTasks: tasks
          .filter((t) => isLate(toLite(t), today))
          .map((t) => ({ id: t.id, title: t.title, lane: t.lane?.name ?? null, dueDate: ymd(t.dueDate), progress: t.progress })),
        budget: a.can.budgetView
          ? {
              total: s.budget,
              spent,
              forecast: s.forecast,
              posts: posts.map((x) => {
                const amount = num(x.amount);
                const sp = spentBy.get(x.id) ?? 0;
                return { name: x.name, amount, spent: sp, pct: amount > 0 ? Math.round((sp / amount) * 100) : 0 };
              }),
            }
          : null,
      };
    });
  }

  async projectCsv(ctx: Ctx, id: string) {
    return this.prisma.tenant(ctx.tenantId!, async (tx) => {
      const a = await this.access.project(tx, ctx, id);
      const tasks = await tx.task.findMany({
        where: { projectId: id },
        include: { lane: { select: { name: true } }, tollgate: { select: { code: true } }, budgetPost: { select: { name: true } } },
        orderBy: [{ sort: 'asc' }],
      });
      const header = ['Task', 'Lane', 'Progress %', 'Start', 'Due', 'Estimate h', 'Tollgate'];
      if (a.can.budgetView) header.push('Budget post');
      return toCsv([
        header,
        ...tasks.map((t) => {
          const row: unknown[] = [t.title, t.lane?.name ?? '', t.progress, ymd(t.startDate) ?? '', ymd(t.dueDate) ?? '', t.estimateHours?.toString() ?? '', t.tollgate?.code ?? ''];
          if (a.can.budgetView) row.push(t.budgetPost?.name ?? '');
          return row;
        }),
      ]);
    });
  }

  // ---------- Scheduled jobs ----------
  /** Nightly: store each project's progress so reports can draw the actual curve. */
  @Cron('15 1 * * *', { timeZone: config.timezone })
  async snapshotAll() {
    if (config.disableCron) return;
    const tenants = await this.prisma.sys.tenant.findMany({ where: { status: { notIn: ['CANCELLED'] } }, select: { id: true } });
    for (const t of tenants) {
      try {
        await this.prisma.tenant(t.id, (tx) => this.snapshotTenant(tx));
      } catch (e) {
        this.log.error(`Snapshot failed for ${t.id}: ${(e as Error).message}`);
      }
    }
  }

  async snapshotTenant(tx: Tx, date = todayUtc()) {
    const projects = await tx.project.findMany({ where: { archivedAt: null } });
    for (const p of projects) {
      const [tasks, spent] = await Promise.all([
        tx.task.findMany({ where: { projectId: p.id }, select: { laneId: true, progress: true, estimateHours: true, startDate: true, dueDate: true } }),
        tx.cost.aggregate({ where: { projectId: p.id }, _sum: { amount: true } }),
      ]);
      const lite = tasks.map(toLite);
      const row = {
        progress: actualProgress(lite),
        planned: plannedProgress(lite, date, p.startDate),
        spent: num(spent._sum.amount),
      };
      await tx.projectSnapshot.upsert({
        where: { projectId_date: { projectId: p.id, date } },
        create: { tenantId: p.tenantId, projectId: p.id, date, ...row },
        update: row,
      });
    }
  }

  /** Monday morning: owners get their project status, managers get the portfolio. */
  @Cron('50 6 * * 1', { timeZone: config.timezone })
  async weeklyEmails() {
    if (config.disableCron) return;
    const tenants = await this.prisma.sys.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL', 'PAST_DUE'] }, isDemo: false } });
    for (const t of tenants) {
      const settings = readSettings(t.settings);
      if (!settings.weeklyReport) continue;
      try {
        await this.weeklyForTenant(t.id, t.slug, t.name, t.currency, settings);
      } catch (e) {
        this.log.error(`Weekly report failed for ${t.slug}: ${(e as Error).message}`);
      }
    }
  }

  private async weeklyForTenant(tenantId: string, slug: string, name: string, currency: string, settings: ReturnType<typeof readSettings>) {
    const members = await this.prisma.sys.membership.findMany({ where: { tenantId, status: 'ACTIVE' }, include: { account: true } });
    const fmt = (n: number) => `${Math.round(n).toLocaleString('sv-SE')} ${currency}`;
    const label = { ON_TRACK: 'On track', AT_RISK: 'At risk', BEHIND: 'Behind' } as const;
    for (const m of members) {
      if (m.account.isDemo) continue;
      const ctx: Ctx = {
        sessionId: '',
        accountId: m.accountId,
        account: { id: m.accountId, name: m.account.name, email: m.account.email, isOperator: false, totpEnabled: m.account.totpEnabled, isDemo: false },
        tenantId,
        tenantRole: m.role,
        tenant: { id: tenantId, slug, name, isDemo: false, status: 'ACTIVE', settings, currency, timezone: config.timezone },
      };
      const rows = await this.projects.portfolio(ctx);
      const relevant = m.role === 'MEMBER' ? rows.filter((r) => r.myRole === 'OWNER' || r.myRole === 'COLEAD') : rows;
      if (!relevant.length) continue;
      const attention = relevant.filter((r) => r.health !== 'ON_TRACK');
      const lines = relevant.map((r) => {
        const money = r.budget ? ` · ${fmt(r.spent ?? 0)} of ${fmt(r.budget)} spent` : '';
        return `• ${r.name} — ${label[r.health]}: ${Math.round(r.progress)}% done, plan ${Math.round(r.planned)}%${money}${r.reasons.length ? ` (${r.reasons.join(', ')})` : ''}`;
      });
      await this.mail.send({
        to: m.account.email,
        subject: attention.length
          ? `Weekly status: ${attention.length} of ${relevant.length} projects need attention`
          : `Weekly status: all ${relevant.length} projects on track`,
        text: `Good morning ${m.account.name.split(' ')[0]},\n\nHere’s where your projects in ${name} stand this week.\n\n${lines.join('\n')}`,
        action: { label: 'Open the portfolio', url: `${config.appUrl}/${slug}` },
      });
    }
  }
}

@Controller()
@UseGuards(TenantGuard)
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('reports/portfolio')
  portfolio(@CurrentCtx() ctx: Ctx) {
    return this.reports.portfolio(ctx);
  }

  @Get('reports/portfolio.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="portfolio.csv"')
  portfolioCsv(@CurrentCtx() ctx: Ctx) {
    return this.reports.portfolioCsv(ctx);
  }

  @Get('projects/:id/report')
  project(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.reports.project(ctx, id);
  }

  @Get('projects/:id/report.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="tasks.csv"')
  projectCsv(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.reports.projectCsv(ctx, id);
  }
}
