import { Body, Controller, Delete, Get, Header, HttpCode, Injectable, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma, TenantRole } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config';
import { AuditService } from '../core/audit.service';
import { Ctx, readSettings, TenantSettings } from '../core/context';
import { AllowInactiveTenant, CurrentCtx, Roles, TenantGuard } from '../core/guards';
import { MailService } from '../core/mail.service';
import { PrismaService, Tx } from '../core/prisma.service';
import { StorageService } from '../core/storage.service';
import { newToken, sha256 } from '../core/tokens';
import { badRequest, forbidden, notFound, parse, zEmail, zName } from '../core/util';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private mail: MailService,
    private storage: StorageService,
    private projects: ProjectsService,
  ) {}

  private t<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.tenant(ctx.tenantId!, fn);
  }

  private noDemo(ctx: Ctx) {
    if (ctx.tenant!.isDemo) throw forbidden('This is a demo. Start a free trial to invite your team.');
  }

  async seatUsage(tx: Tx) {
    const [active, pending] = await Promise.all([
      tx.membership.count({ where: { status: 'ACTIVE' } }),
      tx.invite.count({ where: { acceptedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    return { active, pending, used: active + pending };
  }

  async users(ctx: Ctx) {
    return this.t(ctx, async (tx) => {
      const [members, invites, counts, tenant, seats] = await Promise.all([
        tx.membership.findMany({
          include: { account: { select: { id: true, name: true, email: true, totpEnabled: true, lastLoginAt: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        tx.invite.findMany({ where: { acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }),
        tx.projectMember.groupBy({ by: ['accountId'], _count: { _all: true } }),
        tx.tenant.findUnique({ where: { id: ctx.tenantId! } }),
        this.seatUsage(tx),
      ]);
      const owned = await tx.projectMember.groupBy({ by: ['accountId'], where: { role: 'OWNER' }, _count: { _all: true } });
      const countOf = new Map(counts.map((c) => [c.accountId, c._count._all]));
      const ownedOf = new Map(owned.map((c) => [c.accountId, c._count._all]));
      return {
        seats: { total: tenant!.seats, ...seats },
        members: members.map((m) => ({
          id: m.id,
          accountId: m.accountId,
          name: m.account.name,
          email: m.account.email,
          role: m.role,
          status: m.status,
          projects: countOf.get(m.accountId) ?? 0,
          owns: ownedOf.get(m.accountId) ?? 0,
          mfa: m.account.totpEnabled,
          lastLoginAt: m.account.lastLoginAt,
          isYou: m.accountId === ctx.accountId,
        })),
        invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, createdAt: i.createdAt })),
      };
    });
  }

  async invite(ctx: Ctx, emails: string[], role: TenantRole) {
    this.noDemo(ctx);
    const settings = ctx.tenant!.settings;
    const unique = [...new Set(emails.map((e) => e.toLowerCase()))];
    if (settings.allowedDomains.length) {
      const bad = unique.filter((e) => !settings.allowedDomains.includes(e.split('@')[1] ?? ''));
      if (bad.length) throw badRequest(`Only these domains can be invited: ${settings.allowedDomains.join(', ')} (not ${bad.join(', ')})`);
    }
    const tokens: { email: string; token: string }[] = [];
    await this.t(ctx, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId! } });
      const existing = await tx.membership.findMany({
        where: { status: 'ACTIVE', account: { email: { in: unique } } },
        include: { account: { select: { email: true } } },
      });
      const already = new Set(existing.map((m) => m.account.email));
      const toInvite = unique.filter((e) => !already.has(e));
      const usage = await this.seatUsage(tx);
      if (usage.used + toInvite.length > tenant.seats) {
        throw badRequest(`Not enough seats: ${tenant.seats - usage.used} left. Add seats under Billing first.`);
      }
      for (const email of toInvite) {
        await tx.invite.deleteMany({ where: { email, acceptedAt: null } });
        const token = newToken();
        await tx.invite.create({
          data: {
            tenantId: ctx.tenantId!,
            email,
            role,
            tokenHash: sha256(token),
            invitedById: ctx.accountId,
            expiresAt: new Date(Date.now() + 14 * 86_400_000),
          },
        });
        tokens.push({ email, token });
      }
      await this.audit.log(tx, ctx, 'member.invited', undefined, { emails: toInvite, role });
    });
    for (const { email, token } of tokens) {
      await this.mail.send({
        to: email,
        subject: `${ctx.account.name} invited you to ${ctx.tenant!.name} on Lockred`,
        text: `${ctx.account.name} invited you to join ${ctx.tenant!.name} on Lockred, where the team plans and follows up its projects.\n\nThe invitation is valid for 14 days.`,
        action: { label: 'Accept the invitation', url: `${config.appUrl}/invite/${token}` },
      });
    }
    return { invited: tokens.length };
  }

  async revokeInvite(ctx: Ctx, id: string) {
    return this.t(ctx, async (tx) => {
      await tx.invite.deleteMany({ where: { id, acceptedAt: null } });
      return { ok: true };
    });
  }

  private async assertAdminRemains(tx: Tx, excludingMembershipId: string) {
    const admins = await tx.membership.count({ where: { role: 'ADMIN', status: 'ACTIVE', NOT: { id: excludingMembershipId } } });
    if (!admins) throw badRequest('The organization needs at least one active admin');
  }

  async updateMember(ctx: Ctx, id: string, input: { role?: TenantRole; status?: 'ACTIVE' | 'DISABLED' }) {
    this.noDemo(ctx);
    return this.t(ctx, async (tx) => {
      const m = await tx.membership.findUnique({ where: { id }, include: { account: true } });
      if (!m) throw notFound();
      if ((input.role && input.role !== 'ADMIN') || input.status === 'DISABLED') {
        if (m.role === 'ADMIN') await this.assertAdminRemains(tx, id);
      }
      if (input.status === 'ACTIVE' && m.status === 'DISABLED') {
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId! } });
        const usage = await this.seatUsage(tx);
        if (usage.used + 1 > tenant.seats) throw badRequest('No free seats. Add seats under Billing first.');
      }
      await tx.membership.update({ where: { id }, data: input });
      await this.audit.log(tx, ctx, 'member.updated', { type: 'account', id: m.accountId }, input);
      if (input.status === 'DISABLED') {
        await this.prisma.sys.session.updateMany({ where: { accountId: m.accountId, tenantId: ctx.tenantId! }, data: { tenantId: null } });
      }
      return { ok: true };
    });
  }

  async removeMember(ctx: Ctx, id: string) {
    this.noDemo(ctx);
    return this.t(ctx, async (tx) => {
      const m = await tx.membership.findUnique({ where: { id }, include: { account: true } });
      if (!m) throw notFound();
      if (m.role === 'ADMIN') await this.assertAdminRemains(tx, id);
      const owned = await tx.projectMember.findMany({ where: { accountId: m.accountId, role: 'OWNER' }, include: { project: { select: { name: true } } } });
      if (owned.length) {
        throw badRequest(`${m.account.name} owns ${owned.map((o) => o.project.name).join(', ')}. Give those projects a new owner first.`);
      }
      await tx.task.updateMany({ where: { assigneeAccountId: m.accountId }, data: { assigneeAccountId: null } });
      await tx.projectMember.deleteMany({ where: { accountId: m.accountId } });
      await tx.membership.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'member.removed', { type: 'account', id: m.accountId }, { email: m.account.email });
      await this.prisma.sys.session.updateMany({ where: { accountId: m.accountId, tenantId: ctx.tenantId! }, data: { tenantId: null } });
      return { ok: true };
    });
  }

  async getSettings(ctx: Ctx) {
    const t = await this.prisma.sys.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId! } });
    const s = readSettings(t.settings);
    delete s.demoGuestToken;
    return {
      name: t.name,
      slug: t.slug,
      currency: t.currency,
      timezone: t.timezone,
      supportAccessUntil: t.supportAccessUntil,
      settings: s,
    };
  }

  async updateSettings(ctx: Ctx, input: { name?: string; currency?: string; timezone?: string; settings?: Partial<TenantSettings> }) {
    this.noDemo(ctx);
    return this.t(ctx, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId! } });
      const merged = { ...readSettings(t.settings), ...(input.settings ?? {}) };
      if (merged.behindThreshold < merged.riskThreshold) throw badRequest('“Behind” must be at least as large as “at risk”');
      await tx.tenant.update({
        where: { id: t.id },
        data: {
          name: input.name ?? undefined,
          currency: input.currency ?? undefined,
          timezone: input.timezone ?? undefined,
          settings: merged as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.log(tx, ctx, 'settings.updated', undefined, input as Record<string, unknown>);
      return { ok: true };
    });
  }

  async supportAccess(ctx: Ctx, hours: number) {
    this.noDemo(ctx);
    return this.t(ctx, async (tx) => {
      const until = hours > 0 ? new Date(Date.now() + hours * 3_600_000) : null;
      await tx.tenant.update({ where: { id: ctx.tenantId! }, data: { supportAccessUntil: until } });
      await this.audit.log(tx, ctx, hours > 0 ? 'support_access.granted' : 'support_access.revoked', undefined, { hours });
      return { supportAccessUntil: until };
    });
  }

  async deleteProject(ctx: Ctx, id: string) {
    const keys = await this.t(ctx, async (tx) => {
      const p = await tx.project.findUnique({ where: { id } });
      if (!p) throw notFound();
      if (!p.archivedAt) throw badRequest('Archive the project before deleting it');
      const files = await tx.fileObject.findMany({ where: { projectId: id }, select: { storageKey: true } });
      await tx.cost.deleteMany({ where: { projectId: id } });
      await tx.project.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'project.deleted', { type: 'project', id }, { name: p.name });
      return files.map((f) => f.storageKey);
    });
    for (const k of keys) await this.storage.remove(k);
    return { ok: true };
  }

  async auditLog(ctx: Ctx, before?: string) {
    return this.t(ctx, async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: before ? { createdAt: { lt: new Date(before) } } : {},
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return rows.map((r) => ({ id: r.id, actorName: r.actorName, action: r.action, targetType: r.targetType, targetId: r.targetId, data: r.data, createdAt: r.createdAt }));
    });
  }

  /** Everything the tenant owns, as JSON (files are listed, not embedded). */
  async exportAll(ctx: Ctx) {
    return this.t(ctx, async (tx) => {
      const [tenant, members, projects, projectMembers, directives, kpis, kpiValues, tollgates, criteria, lanes, tasks, checklist, activity, posts, postLinks, costs, files, audit, tickets, messages] =
        await Promise.all([
          tx.tenant.findUnique({ where: { id: ctx.tenantId! }, select: { id: true, slug: true, name: true, currency: true, timezone: true, createdAt: true, settings: true } }),
          tx.membership.findMany({ include: { account: { select: { name: true, email: true } } } }),
          tx.project.findMany(),
          tx.projectMember.findMany(),
          tx.directive.findMany(),
          tx.kpi.findMany(),
          tx.kpiValue.findMany(),
          tx.tollgate.findMany(),
          tx.tollgateCriterion.findMany(),
          tx.lane.findMany(),
          tx.task.findMany(),
          tx.checklistItem.findMany(),
          tx.activity.findMany(),
          tx.budgetPost.findMany(),
          tx.budgetPostLink.findMany(),
          tx.cost.findMany(),
          tx.fileObject.findMany({ select: { id: true, projectId: true, taskId: true, name: true, mime: true, size: true, createdAt: true } }),
          tx.auditLog.findMany(),
          tx.ticket.findMany(),
          tx.ticketMessage.findMany(),
        ]);
      await this.audit.log(tx, ctx, 'data.exported');
      return {
        exportedAt: new Date(),
        tenant,
        members: members.map((m) => ({ name: m.account.name, email: m.account.email, role: m.role, status: m.status, accountId: m.accountId })),
        projects, projectMembers, directives, kpis, kpiValues, tollgates, tollgateCriteria: criteria, lanes, tasks,
        checklistItems: checklist, activity, budgetPosts: posts, budgetPostLinks: postLinks, costs, files, auditLog: audit,
        tickets, ticketMessages: messages,
      };
    });
  }

  /** Active people in the organization, for choosing a new project owner. */
  async people(ctx: Ctx) {
    return this.t(ctx, async (tx) => {
      const [members, owned] = await Promise.all([
        tx.membership.findMany({ where: { status: 'ACTIVE' }, include: { account: { select: { id: true, name: true, email: true } } } }),
        tx.projectMember.groupBy({ by: ['accountId'], where: { role: 'OWNER', project: { archivedAt: null } }, _count: { _all: true } }),
      ]);
      const ownedOf = new Map(owned.map((o) => [o.accountId, o._count._all]));
      return members
        .map((m) => ({ accountId: m.accountId, name: m.account.name, email: m.account.email, role: m.role, owns: ownedOf.get(m.accountId) ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  portfolioAll(ctx: Ctx) {
    return this.projects.portfolio(ctx, { includeArchived: true, all: true });
  }
}

@Controller('people')
@UseGuards(TenantGuard)
@Roles('ADMIN', 'MANAGER')
export class PeopleController {
  constructor(private admin: AdminService) {}

  @Get()
  list(@CurrentCtx() ctx: Ctx) {
    return this.admin.people(ctx);
  }
}

@Controller('admin')
@UseGuards(TenantGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(private admin: AdminService, private projects: ProjectsService) {}

  @Get('users')
  users(@CurrentCtx() ctx: Ctx) {
    return this.admin.users(ctx);
  }

  @Post('invites')
  invite(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ emails: z.array(zEmail).min(1).max(100), role: z.enum(['ADMIN', 'MANAGER', 'MEMBER']) }), body);
    return this.admin.invite(ctx, b.emails, b.role);
  }

  @Delete('invites/:id')
  revokeInvite(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.admin.revokeInvite(ctx, id);
  }

  @Patch('users/:id')
  updateMember(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ role: z.enum(['ADMIN', 'MANAGER', 'MEMBER']).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() }), body);
    return this.admin.updateMember(ctx, id, b);
  }

  @Delete('users/:id')
  removeMember(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.admin.removeMember(ctx, id);
  }

  @Get('settings')
  @AllowInactiveTenant()
  settings(@CurrentCtx() ctx: Ctx) {
    return this.admin.getSettings(ctx);
  }

  @Patch('settings')
  updateSettings(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(
      z.object({
        name: zName.optional(),
        currency: z.string().regex(/^[A-Z]{3}$/).optional(),
        timezone: z.string().min(3).max(60).optional(),
        settings: z
          .object({
            riskThreshold: z.number().min(0).max(100),
            behindThreshold: z.number().min(0).max(100),
            require2faForAdmins: z.boolean(),
            allowedDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(20),
            sessionHours: z.number().int().min(1).max(720),
            taskLinkMaxDays: z.number().int().min(1).max(365),
            taskLinkRoles: z.array(z.enum(['OWNER', 'COLEAD'])).min(1),
            whoCanCreateProjects: z.enum(['EVERYONE', 'MANAGERS']),
            weeklyReport: z.boolean(),
          })
          .partial()
          .optional(),
      }),
      body,
    );
    return this.admin.updateSettings(ctx, b);
  }

  @Post('support-access')
  @HttpCode(200)
  supportAccess(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    return this.admin.supportAccess(ctx, parse(z.object({ hours: z.number().int().min(0).max(168) }), body).hours);
  }

  @Get('projects')
  projectsList(@CurrentCtx() ctx: Ctx) {
    return this.admin.portfolioAll(ctx);
  }

  @Post('projects/:id/archive')
  @HttpCode(200)
  archive(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    return this.projects.archive(ctx, id, parse(z.object({ archived: z.boolean() }), body).archived);
  }

  @Delete('projects/:id')
  deleteProject(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.admin.deleteProject(ctx, id);
  }

  @Get('audit')
  audit(@CurrentCtx() ctx: Ctx, @Query('before') before?: string) {
    return this.admin.auditLog(ctx, before);
  }

  @Get('export')
  @AllowInactiveTenant()
  @Header('Content-Disposition', 'attachment; filename="lockred-export.json"')
  export(@CurrentCtx() ctx: Ctx) {
    return this.admin.exportAll(ctx);
  }
}
