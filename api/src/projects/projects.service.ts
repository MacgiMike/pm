import { Injectable } from '@nestjs/common';
import { KpiDirection, Prisma, ProjectStatus } from '@prisma/client';
import { config } from '../config';
import { AuditService } from '../core/audit.service';
import { Ctx } from '../core/context';
import { MailService } from '../core/mail.service';
import { PrismaService, Tx } from '../core/prisma.service';
import { badRequest, dateOnly, forbidden, notFound, num, numOrNull, todayUtc, ymd } from '../core/util';
import { Access, AccessService } from './access.service';
import { activityOut, addActivity } from './activity';
import { actualProgress, isLate, plannedProgress, summarize, TaskLite } from './metrics';

export const toLite = (t: {
  id?: string;
  laneId: string | null;
  progress: number;
  estimateHours: Prisma.Decimal | null;
  startDate: Date | null;
  dueDate: Date | null;
}): TaskLite => ({
  id: t.id,
  laneId: t.laneId,
  progress: t.progress,
  estimateHours: numOrNull(t.estimateHours),
  startDate: t.startDate,
  dueDate: t.dueDate,
});

const taskLiteSelect = {
  id: true,
  projectId: true,
  laneId: true,
  progress: true,
  estimateHours: true,
  startDate: true,
  dueDate: true,
} as const;

export interface ProjectInput {
  name?: string;
  purpose?: string;
  sponsor?: string;
  startDate?: string;
  endDate?: string;
  inScope?: string[];
  outScope?: string[];
  status?: ProjectStatus;
  approvedBudget?: number;
  setupStep?: number;
}

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private access: AccessService,
    private audit: AuditService,
    private mail: MailService,
  ) {}

  private t<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.tenant(ctx.tenantId!, fn);
  }

  // ================= Portfolio =================
  async portfolio(ctx: Ctx, opts: { includeArchived?: boolean; all?: boolean } = {}) {
    return this.t(ctx, (tx) => this.portfolioTx(tx, ctx, opts));
  }

  async portfolioTx(tx: Tx, ctx: Ctx, opts: { includeArchived?: boolean; all?: boolean } = {}) {
    const seeAll = opts.all || ctx.tenantRole === 'ADMIN' || ctx.tenantRole === 'MANAGER';
    const mine = await tx.projectMember.findMany({ where: { accountId: ctx.accountId } });
    const myRole = new Map(mine.map((m) => [m.projectId, m.role]));
    const projects = await tx.project.findMany({
      where: {
        ...(opts.includeArchived ? {} : { archivedAt: null }),
        ...(seeAll ? {} : { id: { in: [...myRole.keys()] } }),
      },
      orderBy: { createdAt: 'asc' },
    });
    const ids = projects.map((p) => p.id);
    const [tasks, costs, posts, gates, owners] = await Promise.all([
      tx.task.findMany({ where: { projectId: { in: ids } }, select: taskLiteSelect }),
      tx.cost.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _sum: { amount: true } }),
      tx.budgetPost.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _sum: { amount: true } }),
      tx.tollgate.findMany({
        where: { projectId: { in: ids }, passedAt: null },
        orderBy: [{ date: 'asc' }, { sort: 'asc' }],
        include: { criteria: { select: { met: true } } },
      }),
      tx.projectMember.findMany({
        where: { projectId: { in: ids }, role: 'OWNER' },
        include: { account: { select: { id: true, name: true } } },
      }),
    ]);
    const settings = ctx.tenant!.settings;
    const today = todayUtc();
    const spentBy = new Map(costs.map((c) => [c.projectId, num(c._sum.amount)]));
    const postsBy = new Map(posts.map((c) => [c.projectId, num(c._sum.amount)]));
    return projects.map((p) => {
      const pt = tasks.filter((t) => t.projectId === p.id).map(toLite);
      const s = summarize(
        { startDate: p.startDate, approvedBudget: num(p.approvedBudget) },
        pt,
        spentBy.get(p.id) ?? 0,
        postsBy.get(p.id) ?? 0,
        settings,
        today,
      );
      const gate = gates.find((g) => g.projectId === p.id);
      const owner = owners.find((o) => o.projectId === p.id);
      const role = myRole.get(p.id) ?? 'VIEWER';
      const canSeeBudget = role !== 'CONTRIBUTOR';
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        archived: !!p.archivedAt,
        startDate: ymd(p.startDate),
        endDate: ymd(p.endDate),
        owner: owner ? { id: owner.account.id, name: owner.account.name } : null,
        myRole: role,
        nextTollgate: gate
          ? {
              code: gate.code,
              name: gate.name,
              date: ymd(gate.date),
              met: gate.criteria.filter((c) => c.met).length,
              total: gate.criteria.length,
            }
          : null,
        taskCount: pt.length,
        progress: s.progress,
        planned: s.planned,
        gap: s.gap,
        health: s.health,
        reasons: canSeeBudget ? s.reasons : s.reasons.filter((r) => !r.includes('budget')),
        lateTasks: s.lateTasks,
        budget: canSeeBudget ? s.budget : null,
        spent: canSeeBudget ? s.spent : null,
        forecast: canSeeBudget ? s.forecast : null,
      };
    });
  }

  // ================= Create / update =================
  async create(ctx: Ctx, input: { name: string; startDate: string; endDate: string; purpose?: string }) {
    const who = ctx.tenant!.settings.whoCanCreateProjects;
    if (who === 'MANAGERS' && ctx.tenantRole === 'MEMBER') {
      throw forbidden('Only admins and portfolio managers can create projects here');
    }
    const start = dateOnly(input.startDate);
    const end = dateOnly(input.endDate);
    if (end < start) throw badRequest('The end date is before the start date');
    return this.t(ctx, async (tx) => {
      const p = await tx.project.create({
        data: {
          tenantId: ctx.tenantId!,
          name: input.name.trim(),
          purpose: input.purpose?.trim() ?? '',
          startDate: start,
          endDate: end,
          status: 'SETUP',
        },
      });
      await tx.projectMember.create({
        data: { tenantId: ctx.tenantId!, projectId: p.id, accountId: ctx.accountId, role: 'OWNER', addedById: ctx.accountId },
      });
      await addActivity(tx, ctx, p.id, { kind: 'project.created', text: `created the project` });
      await this.audit.log(tx, ctx, 'project.created', { type: 'project', id: p.id }, { name: p.name });
      return { id: p.id };
    });
  }

  async update(ctx: Ctx, id: string, input: ProjectInput) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, id);
      this.access.require(a, 'plan');
      if (input.approvedBudget !== undefined) this.access.require(a, 'budgetEdit');
      const data: Prisma.ProjectUpdateInput = {};
      if (input.name !== undefined) data.name = input.name.trim();
      if (input.purpose !== undefined) data.purpose = input.purpose;
      if (input.sponsor !== undefined) data.sponsor = input.sponsor;
      if (input.startDate !== undefined) data.startDate = dateOnly(input.startDate);
      if (input.endDate !== undefined) data.endDate = dateOnly(input.endDate);
      if (input.inScope !== undefined) data.inScope = input.inScope;
      if (input.outScope !== undefined) data.outScope = input.outScope;
      if (input.status !== undefined && input.status !== 'ARCHIVED') data.status = input.status;
      if (input.approvedBudget !== undefined) data.approvedBudget = input.approvedBudget;
      if (input.setupStep !== undefined) data.setupStep = input.setupStep;
      const start = (data.startDate as Date | undefined) ?? a.project.startDate;
      const end = (data.endDate as Date | undefined) ?? a.project.endDate;
      if (end < start) throw badRequest('The end date is before the start date');
      await tx.project.update({ where: { id }, data });
      if (input.approvedBudget !== undefined && num(a.project.approvedBudget) !== input.approvedBudget) {
        await addActivity(tx, ctx, id, {
          kind: 'budget.approved',
          text: `set the approved budget to ${input.approvedBudget}`,
          budgetOnly: true,
        });
      }
      return { ok: true };
    });
  }

  async archive(ctx: Ctx, id: string, archived: boolean) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, id);
      this.access.require(a, 'archive');
      await tx.project.update({
        where: { id },
        data: archived
          ? { archivedAt: new Date(), status: 'ARCHIVED' }
          : { archivedAt: null, status: a.project.status === 'ARCHIVED' ? 'ACTIVE' : a.project.status },
      });
      await this.audit.log(tx, ctx, archived ? 'project.archived' : 'project.restored', { type: 'project', id });
      return { ok: true };
    });
  }

  // ================= Owner change (managers / admins) =================
  async changeOwner(ctx: Ctx, id: string, input: { accountId: string; reason: string; keepAsColead: boolean }) {
    const result = await this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, id);
      this.access.require(a, 'changeOwner');
      const target = await tx.membership.findUnique({
        where: { tenantId_accountId: { tenantId: ctx.tenantId!, accountId: input.accountId } },
        include: { account: true },
      });
      if (!target || target.status !== 'ACTIVE') throw badRequest('That person is not an active member of the organization');
      const current = await tx.projectMember.findMany({ where: { projectId: id, role: 'OWNER' }, include: { account: true } });
      for (const c of current) {
        if (c.accountId === input.accountId) continue;
        if (input.keepAsColead) await tx.projectMember.update({ where: { id: c.id }, data: { role: 'COLEAD' } });
        else await tx.projectMember.delete({ where: { id: c.id } });
      }
      await tx.projectMember.upsert({
        where: { projectId_accountId: { projectId: id, accountId: input.accountId } },
        create: { tenantId: ctx.tenantId!, projectId: id, accountId: input.accountId, role: 'OWNER', addedById: ctx.accountId },
        update: { role: 'OWNER' },
      });
      const prev = current.map((c) => c.account.name).join(', ') || 'nobody';
      await addActivity(tx, ctx, id, {
        kind: 'owner.changed',
        text: `made ${target.account.name} the owner (was ${prev})`,
        data: { reason: input.reason },
      });
      await this.audit.log(tx, ctx, 'project.owner_changed', { type: 'project', id }, {
        from: current.map((c) => c.accountId),
        to: input.accountId,
        reason: input.reason,
      });
      return { project: a.project, newOwner: target.account, previous: current.map((c) => c.account) };
    });
    const url = `${config.appUrl}/${ctx.tenant!.slug}/p/${id}`;
    await this.mail.send({
      to: result.newOwner.email,
      subject: `You now own ${result.project.name}`,
      text: `${ctx.account.name} made you the owner of ${result.project.name}.${input.reason ? `\n\nReason: ${input.reason}` : ''}`,
      action: { label: 'Open the project', url },
    });
    for (const p of result.previous) {
      if (p.id === result.newOwner.id) continue;
      await this.mail.send({
        to: p.email,
        subject: `${result.newOwner.name} now owns ${result.project.name}`,
        text: `${ctx.account.name} changed the owner of ${result.project.name} to ${result.newOwner.name}.${
          input.keepAsColead ? ' You stay on the project as co-lead.' : ''
        }${input.reason ? `\n\nReason: ${input.reason}` : ''}`,
        action: { label: 'Open the project', url },
      });
    }
    return { ok: true };
  }

  // ================= Overview =================
  async overview(ctx: Ctx, id: string) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, id);
      return this.overviewTx(tx, ctx, a);
    });
  }

  async overviewTx(tx: Tx, ctx: Ctx, a: Access) {
    const p = a.project;
    const today = todayUtc();
    const [tasks, lanes, directives, kpis, gates, members, costsSum, postsSum, activity] = await Promise.all([
      tx.task.findMany({ where: { projectId: p.id }, select: { ...taskLiteSelect, tollgateId: true, title: true } }),
      tx.lane.findMany({ where: { projectId: p.id }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
      tx.directive.findMany({ where: { projectId: p.id }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
      tx.kpi.findMany({
        where: { projectId: p.id },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
        include: { values: { orderBy: { measuredAt: 'desc' }, take: 12 } },
      }),
      tx.tollgate.findMany({
        where: { projectId: p.id },
        orderBy: [{ date: 'asc' }, { sort: 'asc' }],
        include: { criteria: { orderBy: { sort: 'asc' } } },
      }),
      tx.projectMember.findMany({ where: { projectId: p.id }, include: { account: { select: { id: true, name: true, email: true } } } }),
      tx.cost.aggregate({ where: { projectId: p.id }, _sum: { amount: true } }),
      tx.budgetPost.aggregate({ where: { projectId: p.id }, _sum: { amount: true } }),
      tx.activity.findMany({
        where: { projectId: p.id, ...(a.can.budgetView ? {} : { budgetOnly: false }) },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
    ]);
    const lite = tasks.map(toLite);
    const s = summarize(
      { startDate: p.startDate, approvedBudget: num(p.approvedBudget) },
      lite,
      num(costsSum._sum.amount),
      num(postsSum._sum.amount),
      ctx.tenant!.settings,
      today,
    );
    const nameOf = new Map(members.map((m) => [m.accountId, m.account.name]));
    const owner = members.find((m) => m.role === 'OWNER');
    const laneOut = lanes.map((l) => {
      const lt = lite.filter((t) => t.laneId === l.id);
      return {
        id: l.id,
        name: l.name,
        color: l.color,
        leadAccountId: l.leadAccountId,
        leadName: l.leadAccountId ? nameOf.get(l.leadAccountId) ?? null : null,
        taskCount: lt.length,
        progress: actualProgress(lt),
        planned: plannedProgress(lt, today, p.startDate),
      };
    });
    const next = gates.find((g) => !g.passedAt) ?? null;
    const attention: { kind: string; text: string; taskId?: string }[] = [];
    for (const t of tasks) {
      if (isLate(toLite(t), today)) attention.push({ kind: 'late_task', text: `${t.title} is overdue`, taskId: t.id });
    }
    for (const l of laneOut) {
      if (l.planned - l.progress > ctx.tenant!.settings.riskThreshold) {
        attention.push({ kind: 'lane_behind', text: `${l.name} is ${Math.round(l.planned - l.progress)} pts behind plan` });
      }
    }
    return {
      id: p.id,
      name: p.name,
      purpose: p.purpose,
      sponsor: p.sponsor,
      startDate: ymd(p.startDate),
      endDate: ymd(p.endDate),
      status: p.status,
      archived: !!p.archivedAt,
      setupStep: p.setupStep,
      inScope: p.inScope,
      outScope: p.outScope,
      role: a.role,
      can: a.can,
      owner: owner ? { id: owner.accountId, name: owner.account.name } : null,
      memberCount: members.length,
      summary: {
        progress: s.progress,
        planned: s.planned,
        gap: s.gap,
        health: s.health,
        reasons: a.can.budgetView ? s.reasons : s.reasons.filter((r) => !r.includes('budget')),
        lateTasks: s.lateTasks,
        taskCount: tasks.length,
      },
      budget: a.can.budgetView
        ? {
            approved: num(p.approvedBudget),
            allocated: num(postsSum._sum.amount),
            total: s.budget,
            spent: s.spent,
            forecast: s.forecast,
            currency: ctx.tenant!.currency,
          }
        : null,
      directives: directives.map((d) => ({ id: d.id, text: d.text, source: d.source, sort: d.sort })),
      kpis: kpis.map((k) => kpiOut(k)),
      tollgates: gates.map((g) => ({
        id: g.id,
        code: g.code,
        name: g.name,
        date: ymd(g.date),
        passedAt: g.passedAt,
        sort: g.sort,
        criteria: g.criteria.map((c) => ({ id: c.id, text: c.text, met: c.met })),
        met: g.criteria.filter((c) => c.met).length,
        total: g.criteria.length,
        openTasks: tasks.filter((t) => t.tollgateId === g.id && t.progress < 100).length,
      })),
      nextTollgate: next ? { id: next.id, code: next.code, name: next.name, date: ymd(next.date) } : null,
      lanes: laneOut,
      attention: attention.slice(0, 8),
      activity: activity.map(activityOut),
    };
  }

  async activity(ctx: Ctx, id: string, before?: string) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, id);
      const rows = await tx.activity.findMany({
        where: {
          projectId: id,
          ...(a.can.budgetView ? {} : { budgetOnly: false }),
          ...(before ? { createdAt: { lt: new Date(before) } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return rows.map(activityOut);
    });
  }

  // ================= Directives =================
  async addDirective(ctx: Ctx, id: string, input: { text: string; source?: string }) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      const count = await tx.directive.count({ where: { projectId: id } });
      const d = await tx.directive.create({
        data: { tenantId: ctx.tenantId!, projectId: id, text: input.text, source: input.source ?? '', sort: count },
      });
      return { id: d.id };
    });
  }

  async updateDirective(ctx: Ctx, id: string, did: string, input: { text?: string; source?: string; sort?: number }) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      const r = await tx.directive.updateMany({ where: { id: did, projectId: id }, data: input });
      if (!r.count) throw notFound();
      return { ok: true };
    });
  }

  async deleteDirective(ctx: Ctx, id: string, did: string) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      await tx.directive.deleteMany({ where: { id: did, projectId: id } });
      return { ok: true };
    });
  }

  // ================= KPIs =================
  async addKpi(ctx: Ctx, id: string, input: KpiInput) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      const count = await tx.kpi.count({ where: { projectId: id } });
      const k = await tx.kpi.create({
        data: {
          tenantId: ctx.tenantId!,
          projectId: id,
          name: input.name!,
          unit: input.unit ?? '',
          baseline: input.baseline ?? null,
          target: input.target ?? 0,
          direction: input.direction ?? 'INCREASE',
          frequency: input.frequency ?? 'Monthly',
          ownerName: input.ownerName ?? '',
          afterGoLive: input.afterGoLive ?? false,
          sort: count,
        },
      });
      return { id: k.id };
    });
  }

  async updateKpi(ctx: Ctx, id: string, kid: string, input: KpiInput) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      const r = await tx.kpi.updateMany({ where: { id: kid, projectId: id }, data: input });
      if (!r.count) throw notFound();
      return { ok: true };
    });
  }

  async deleteKpi(ctx: Ctx, id: string, kid: string) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      await tx.kpi.deleteMany({ where: { id: kid, projectId: id } });
      return { ok: true };
    });
  }

  async addKpiValue(ctx: Ctx, id: string, kid: string, input: { value: number; measuredAt: string; note?: string }) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      const k = await tx.kpi.findFirst({ where: { id: kid, projectId: id } });
      if (!k) throw notFound();
      await tx.kpiValue.create({
        data: {
          tenantId: ctx.tenantId!,
          kpiId: kid,
          value: input.value,
          measuredAt: dateOnly(input.measuredAt),
          note: input.note ?? '',
          createdById: ctx.accountId,
        },
      });
      await addActivity(tx, ctx, id, { kind: 'kpi.value', text: `logged ${k.name}: ${input.value}${k.unit ? ' ' + k.unit : ''}` });
      return { ok: true };
    });
  }

  async deleteKpiValue(ctx: Ctx, id: string, kid: string, vid: string) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      const k = await tx.kpi.findFirst({ where: { id: kid, projectId: id } });
      if (!k) throw notFound();
      await tx.kpiValue.deleteMany({ where: { id: vid, kpiId: kid } });
      return { ok: true };
    });
  }

  // ================= Tollgates =================
  async addTollgate(ctx: Ctx, id: string, input: { name: string; date: string; code?: string; criteria?: string[] }) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      const count = await tx.tollgate.count({ where: { projectId: id } });
      const g = await tx.tollgate.create({
        data: {
          tenantId: ctx.tenantId!,
          projectId: id,
          code: input.code?.trim() || `TG${count + 1}`,
          name: input.name,
          date: dateOnly(input.date),
          sort: count,
        },
      });
      if (input.criteria?.length) {
        await tx.tollgateCriterion.createMany({
          data: input.criteria.map((text, i) => ({ tenantId: ctx.tenantId!, tollgateId: g.id, text, sort: i })),
        });
      }
      return { id: g.id };
    });
  }

  async applyTollgateTemplate(ctx: Ctx, id: string, template: 'standard5' | 'light3') {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, id);
      this.access.require(a, 'plan');
      const existing = await tx.tollgate.count({ where: { projectId: id } });
      if (existing) throw badRequest('This project already has tollgates. Remove them first to use a template.');
      const defs: [string, number, string[]][] =
        template === 'standard5'
          ? [
              ['Project start', 0, ['Directives approved', 'Budget approved']],
              ['Design approved', 0.25, ['Solution design signed off', 'Scope agreed']],
              ['Build approval', 0.55, ['Build complete', 'Test plan approved']],
              ['Go-live', 0.85, ['Acceptance test passed', 'Users trained']],
              ['Closure', 1, ['KPIs baselined', 'Lessons learned recorded']],
            ]
          : [
              ['Start', 0, ['Scope and budget approved']],
              ['Mid-point review', 0.5, ['On track against plan']],
              ['Closure', 1, ['Delivered and handed over']],
            ];
      const span = a.project.endDate.getTime() - a.project.startDate.getTime();
      for (let i = 0; i < defs.length; i++) {
        const [name, f, criteria] = defs[i];
        const date = new Date(a.project.startDate.getTime() + Math.round((span * f) / 86_400_000) * 86_400_000);
        const g = await tx.tollgate.create({
          data: { tenantId: ctx.tenantId!, projectId: id, code: `TG${i + 1}`, name, date, sort: i },
        });
        await tx.tollgateCriterion.createMany({
          data: criteria.map((text, j) => ({ tenantId: ctx.tenantId!, tollgateId: g.id, text, sort: j })),
        });
      }
      return { ok: true };
    });
  }

  async updateTollgate(ctx: Ctx, id: string, gid: string, input: { name?: string; date?: string; code?: string }) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      const r = await tx.tollgate.updateMany({
        where: { id: gid, projectId: id },
        data: { name: input.name, code: input.code, date: input.date ? dateOnly(input.date) : undefined },
      });
      if (!r.count) throw notFound();
      return { ok: true };
    });
  }

  async deleteTollgate(ctx: Ctx, id: string, gid: string) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      await tx.tollgate.deleteMany({ where: { id: gid, projectId: id } });
      return { ok: true };
    });
  }

  async passTollgate(ctx: Ctx, id: string, gid: string, passed: boolean) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      const g = await tx.tollgate.findFirst({ where: { id: gid, projectId: id } });
      if (!g) throw notFound();
      await tx.tollgate.update({
        where: { id: gid },
        data: passed ? { passedAt: new Date(), passedById: ctx.accountId } : { passedAt: null, passedById: null },
      });
      await addActivity(tx, ctx, id, {
        kind: passed ? 'tollgate.passed' : 'tollgate.reopened',
        text: passed ? `passed ${g.code} ${g.name}` : `reopened ${g.code} ${g.name}`,
      });
      await this.audit.log(tx, ctx, passed ? 'tollgate.passed' : 'tollgate.reopened', { type: 'tollgate', id: gid });
      return { ok: true };
    });
  }

  async addCriterion(ctx: Ctx, id: string, gid: string, text: string) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      const g = await tx.tollgate.findFirst({ where: { id: gid, projectId: id } });
      if (!g) throw notFound();
      const count = await tx.tollgateCriterion.count({ where: { tollgateId: gid } });
      const c = await tx.tollgateCriterion.create({ data: { tenantId: ctx.tenantId!, tollgateId: gid, text, sort: count } });
      return { id: c.id };
    });
  }

  async updateCriterion(ctx: Ctx, id: string, cid: string, input: { text?: string; met?: boolean }) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      const r = await tx.tollgateCriterion.updateMany({ where: { id: cid, tollgate: { projectId: id } }, data: input });
      if (!r.count) throw notFound();
      return { ok: true };
    });
  }

  async deleteCriterion(ctx: Ctx, id: string, cid: string) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      await tx.tollgateCriterion.deleteMany({ where: { id: cid, tollgate: { projectId: id } } });
      return { ok: true };
    });
  }

  // ================= Lanes =================
  async addLane(ctx: Ctx, id: string, input: { name: string; color?: string; leadAccountId?: string | null }) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      const count = await tx.lane.count({ where: { projectId: id } });
      const palette = ['#2F5BD3', '#0F6B5C', '#A3201C', '#8A4306', '#6B3FA0', '#1F6F8B', '#5C5F67'];
      const l = await tx.lane.create({
        data: {
          tenantId: ctx.tenantId!,
          projectId: id,
          name: input.name,
          color: input.color ?? palette[count % palette.length],
          leadAccountId: input.leadAccountId ?? null,
          sort: count,
        },
      });
      return { id: l.id };
    });
  }

  async updateLane(ctx: Ctx, id: string, lid: string, input: { name?: string; color?: string; leadAccountId?: string | null; sort?: number }) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      const r = await tx.lane.updateMany({ where: { id: lid, projectId: id }, data: input });
      if (!r.count) throw notFound();
      return { ok: true };
    });
  }

  async deleteLane(ctx: Ctx, id: string, lid: string) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      await tx.lane.deleteMany({ where: { id: lid, projectId: id } });
      return { ok: true };
    });
  }

  async reorderLanes(ctx: Ctx, id: string, ids: string[]) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, id), 'plan');
      for (let i = 0; i < ids.length; i++) {
        await tx.lane.updateMany({ where: { id: ids[i], projectId: id }, data: { sort: i } });
      }
      return { ok: true };
    });
  }
}

export interface KpiInput {
  name?: string;
  unit?: string;
  baseline?: number | null;
  target?: number;
  direction?: KpiDirection;
  frequency?: string;
  ownerName?: string;
  afterGoLive?: boolean;
  sort?: number;
}

export function kpiOut(k: {
  id: string;
  name: string;
  unit: string;
  baseline: Prisma.Decimal | null;
  target: Prisma.Decimal;
  direction: KpiDirection;
  frequency: string;
  ownerName: string;
  afterGoLive: boolean;
  sort: number;
  values: { id: string; value: Prisma.Decimal; measuredAt: Date; note: string }[];
}) {
  const latest = k.values[0];
  const target = num(k.target);
  let status: 'ON_TARGET' | 'OFF_TARGET' | 'NO_DATA' = 'NO_DATA';
  if (latest) {
    const v = num(latest.value);
    status = (k.direction === 'INCREASE' ? v >= target : v <= target) ? 'ON_TARGET' : 'OFF_TARGET';
  }
  return {
    id: k.id,
    name: k.name,
    unit: k.unit,
    baseline: numOrNull(k.baseline),
    target,
    direction: k.direction,
    frequency: k.frequency,
    ownerName: k.ownerName,
    afterGoLive: k.afterGoLive,
    sort: k.sort,
    status,
    latest: latest ? { value: num(latest.value), measuredAt: ymd(latest.measuredAt), note: latest.note } : null,
    values: k.values.map((v) => ({ id: v.id, value: num(v.value), measuredAt: ymd(v.measuredAt), note: v.note })).reverse(),
  };
}

