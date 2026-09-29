import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PlanTier, Prisma, TenantStatus } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { StripeService } from '../billing/stripe.service';
import { config } from '../config';
import { Ctx, DEFAULT_SETTINGS, readSettings } from '../core/context';
import { CurrentCtx, OperatorGuard } from '../core/guards';
import { MailService } from '../core/mail.service';
import { PrismaService } from '../core/prisma.service';
import { isValidSlug, slugify } from '../core/slugs';
import { StorageService } from '../core/storage.service';
import { newToken, sha256 } from '../core/tokens';
import { addDays, badRequest, notFound, num, parse, zEmail, zName } from '../core/util';
import { DemoService, nextDemoReset } from '../demo/demo';
import { ProjectsService } from '../projects/projects.service';
import { ticketRef } from '../support/support';

@Injectable()
export class OpsService {
  constructor(
    private prisma: PrismaService,
    private stripe: StripeService,
    private mail: MailService,
    private storage: StorageService,
    private demo: DemoService,
    private auth: AuthService,
    private projects: ProjectsService,
  ) {}

  private async tenantAudit(tenantId: string, ctx: Ctx, action: string, data: Record<string, unknown> = {}) {
    await this.prisma.sys.auditLog.create({
      data: { tenantId, actorAccountId: null, actorName: `Lockred support (${ctx.account.name})`, action, data: data as Prisma.InputJsonValue },
    });
  }

  // ---------- Overview ----------
  async overview() {
    const tenants = await this.prisma.sys.tenant.findMany({ where: { isDemo: false } });
    const openTickets = await this.prisma.sys.ticket.count({ where: { status: { in: ['OPEN'] } } });
    let mrr: { amount: number; currency: string } | null = null;
    if (this.stripe.enabled) {
      let amount = 0;
      let currency = 'SEK';
      for (const t of tenants.filter((x) => x.status === 'ACTIVE' && x.stripeSubscriptionId)) {
        const priceId = config.stripe.prices[t.plan as 'STARTER' | 'TEAM' | 'BUSINESS'];
        if (!priceId) continue;
        const p = await this.stripe.price(priceId);
        if (!p) continue;
        currency = p.currency;
        amount += (p.interval === 'year' ? p.amount / 12 : p.amount) * t.seats;
      }
      mrr = { amount: Math.round(amount), currency };
    }
    return {
      paying: tenants.filter((t) => t.status === 'ACTIVE').length,
      trial: tenants.filter((t) => t.status === 'TRIAL').length,
      pastDue: tenants.filter((t) => t.status === 'PAST_DUE').length,
      suspended: tenants.filter((t) => t.status === 'SUSPENDED' || t.status === 'CANCELLED').length,
      openTickets,
      mrr,
      stripeConfigured: this.stripe.enabled,
    };
  }

  // ---------- Tenants ----------
  async tenants(q?: string) {
    const rows = await this.prisma.sys.tenant.findMany({
      where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        referredBy: { select: { name: true, code: true } },
        demoOf: { select: { name: true } },
        _count: { select: { memberships: { where: { status: 'ACTIVE' } }, projects: true } },
      },
      take: 500,
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      url: `${config.appUrl}/${t.slug}`,
      status: t.status,
      plan: t.plan,
      seats: t.seats,
      seatsUsed: t._count.memberships,
      projects: t._count.projects,
      trialEndsAt: t.trialEndsAt,
      createdAt: t.createdAt,
      isDemo: t.isDemo,
      demoOf: t.demoOf?.name ?? null,
      referredBy: t.referredBy,
      stripeCustomerId: t.stripeCustomerId,
      supportAccess: !!t.supportAccessUntil && t.supportAccessUntil > new Date(),
    }));
  }

  async tenant(ctx: Ctx, id: string) {
    const t = await this.prisma.sys.tenant.findUnique({
      where: { id },
      include: { referredBy: { select: { name: true, code: true } } },
    });
    if (!t) throw notFound();
    const [admins, members, tickets, audit] = await Promise.all([
      this.prisma.sys.membership.findMany({ where: { tenantId: id, role: 'ADMIN', status: 'ACTIVE' }, include: { account: { select: { name: true, email: true } } } }),
      this.prisma.sys.membership.count({ where: { tenantId: id, status: 'ACTIVE' } }),
      this.prisma.sys.ticket.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.sys.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const access = !!t.supportAccessUntil && t.supportAccessUntil > new Date();
    let portfolio = null;
    if (access) {
      const settings = readSettings(t.settings);
      const opsCtx: Ctx = {
        ...ctx,
        tenantId: t.id,
        tenantRole: 'MANAGER',
        tenant: { id: t.id, slug: t.slug, name: t.name, isDemo: t.isDemo, status: t.status, settings, currency: t.currency, timezone: t.timezone },
      };
      portfolio = await this.prisma.tenant(t.id, (tx) => this.projects.portfolioTx(tx, opsCtx, { all: true }));
    }
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      plan: t.plan,
      seats: t.seats,
      members,
      trialEndsAt: t.trialEndsAt,
      createdAt: t.createdAt,
      isDemo: t.isDemo,
      stripeCustomerId: t.stripeCustomerId,
      stripeSubscriptionId: t.stripeSubscriptionId,
      referredBy: t.referredBy,
      supportAccessUntil: access ? t.supportAccessUntil : null,
      admins: admins.map((a) => ({ name: a.account.name, email: a.account.email })),
      tickets: tickets.map((x) => ({ id: x.id, ref: ticketRef(x.number), subject: x.subject, status: x.status, createdAt: x.createdAt })),
      audit: audit.map((a) => ({ actorName: a.actorName, action: a.action, createdAt: a.createdAt })),
      portfolio,
    };
  }

  async createTenant(ctx: Ctx, input: { name: string; slug?: string; adminEmail: string; adminName: string; plan: PlanTier; seats: number; trialDays: number }) {
    const slug = input.slug?.trim() || slugify(input.name);
    if (!isValidSlug(slug)) throw badRequest('That web address can’t be used');
    if (await this.prisma.sys.tenant.findUnique({ where: { slug } })) throw badRequest('That web address is taken');
    const t = await this.prisma.sys.tenant.create({
      data: {
        slug,
        name: input.name,
        status: input.trialDays > 0 ? 'TRIAL' : 'ACTIVE',
        plan: input.plan,
        seats: input.seats,
        trialEndsAt: input.trialDays > 0 ? addDays(new Date(), input.trialDays) : null,
        settings: DEFAULT_SETTINGS as unknown as Prisma.InputJsonValue,
      },
    });
    const token = newToken();
    await this.prisma.sys.invite.create({
      data: { tenantId: t.id, email: input.adminEmail, role: 'ADMIN', tokenHash: sha256(token), expiresAt: addDays(new Date(), 14) },
    });
    await this.tenantAudit(t.id, ctx, 'tenant.created_by_operator');
    await this.mail.send({
      to: input.adminEmail,
      subject: `Your Lockred organization ${t.name} is ready`,
      text: `Hi ${input.adminName.split(' ')[0]},\n\nWe’ve set up ${t.name} on Lockred for you. Accept the invitation to become its admin.`,
      action: { label: 'Accept the invitation', url: `${config.appUrl}/invite/${token}` },
    });
    return { id: t.id, slug };
  }

  async updateTenant(ctx: Ctx, id: string, input: { name?: string; status?: TenantStatus; plan?: PlanTier; seats?: number; trialEndsAt?: string | null }) {
    const t = await this.prisma.sys.tenant.findUnique({ where: { id } });
    if (!t) throw notFound();
    await this.prisma.sys.tenant.update({
      where: { id },
      data: {
        name: input.name,
        status: input.status,
        plan: input.plan,
        seats: input.seats,
        trialEndsAt: input.trialEndsAt === undefined ? undefined : input.trialEndsAt ? new Date(input.trialEndsAt) : null,
        cancelledAt: input.status === 'CANCELLED' ? new Date() : input.status ? null : undefined,
      },
    });
    await this.tenantAudit(id, ctx, 'tenant.updated_by_operator', input as Record<string, unknown>);
    if (input.status === 'SUSPENDED' || input.status === 'CANCELLED') {
      await this.prisma.sys.session.updateMany({ where: { tenantId: id }, data: { tenantId: null } });
    }
    return { ok: true };
  }

  async deleteTenant(id: string, confirmSlug: string) {
    const t = await this.prisma.sys.tenant.findUnique({ where: { id } });
    if (!t) throw notFound();
    if (t.slug !== confirmSlug) throw badRequest('Type the organization’s web address to confirm');
    if (!t.isDemo && t.status !== 'CANCELLED' && t.status !== 'SUSPENDED') throw badRequest('Suspend or cancel the organization before deleting it');
    await this.prisma.sys.session.updateMany({ where: { tenantId: id }, data: { tenantId: null } });
    await this.prisma.sys.cost.deleteMany({ where: { tenantId: id } });
    await this.prisma.sys.tenant.delete({ where: { id } });
    await this.storage.removeTenant(id);
    return { ok: true };
  }

  // ---------- Support ----------
  async tickets(status?: string) {
    const rows = await this.prisma.sys.ticket.findMany({
      where: status === 'open' ? { status: { in: ['OPEN', 'WAITING_ON_CUSTOMER', 'PLANNED'] } } : status === 'closed' ? { status: { in: ['RESOLVED', 'CLOSED'] } } : {},
      include: { tenant: { select: { name: true, slug: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return rows.map((t) => {
      const last = t.messages[0];
      const waitingOnUs = t.status === 'OPEN' && (!last || !last.fromOperator);
      const since = last && !last.fromOperator ? last.createdAt : t.createdAt;
      const targetHours = t.severity === 'BLOCKING' ? 4 : 24;
      return {
        id: t.id,
        ref: ticketRef(t.number),
        tenant: t.tenant,
        type: t.type,
        severity: t.severity,
        subject: t.subject,
        status: t.status,
        createdByName: t.createdByName,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        waitingOnUs,
        replyDueAt: waitingOnUs ? new Date(since.getTime() + targetHours * 3_600_000) : null,
      };
    });
  }

  async ticket(id: string) {
    const t = await this.prisma.sys.ticket.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true, slug: true, plan: true } }, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!t) throw notFound();
    const account = t.createdById ? await this.prisma.sys.account.findUnique({ where: { id: t.createdById }, select: { email: true } }) : null;
    return {
      id: t.id,
      ref: ticketRef(t.number),
      tenant: t.tenant,
      type: t.type,
      severity: t.severity,
      subject: t.subject,
      body: t.body,
      status: t.status,
      createdByName: t.createdByName,
      createdByEmail: account?.email ?? null,
      diagnostics: t.diagnostics,
      createdAt: t.createdAt,
      messages: t.messages.map((m) => ({ id: m.id, authorName: m.authorName, fromOperator: m.fromOperator, body: m.body, createdAt: m.createdAt })),
    };
  }

  async replyTicket(ctx: Ctx, id: string, body: string, status?: 'OPEN' | 'WAITING_ON_CUSTOMER' | 'PLANNED' | 'RESOLVED' | 'CLOSED') {
    const t = await this.prisma.sys.ticket.findUnique({ where: { id }, include: { tenant: true } });
    if (!t) throw notFound();
    await this.prisma.sys.ticketMessage.create({ data: { tenantId: t.tenantId, ticketId: id, authorName: `${ctx.account.name} (Lockred)`, fromOperator: true, body } });
    await this.prisma.sys.ticket.update({ where: { id }, data: { status: status ?? 'WAITING_ON_CUSTOMER' } });
    const account = t.createdById ? await this.prisma.sys.account.findUnique({ where: { id: t.createdById } }) : null;
    if (account) {
      await this.mail.send({
        to: account.email,
        subject: `[${ticketRef(t.number)}] Reply from Lockred: ${t.subject}`,
        text: body,
        action: { label: 'View and reply', url: `${config.appUrl}/${t.tenant.slug}/support/${t.id}` },
      });
    }
    return { ok: true };
  }

  async setTicketStatus(id: string, status: 'OPEN' | 'WAITING_ON_CUSTOMER' | 'PLANNED' | 'RESOLVED' | 'CLOSED') {
    await this.prisma.sys.ticket.update({ where: { id }, data: { status } });
    return { ok: true };
  }

  async ticketToIdea(id: string) {
    const t = await this.prisma.sys.ticket.findUnique({ where: { id } });
    if (!t) throw notFound();
    const idea = await this.prisma.sys.idea.create({ data: { title: t.subject, description: t.body.slice(0, 2000) } });
    await this.prisma.sys.ticket.update({ where: { id }, data: { status: 'PLANNED' } });
    return { id: idea.id };
  }

  // ---------- Ideas ----------
  async ideas() {
    const rows = await this.prisma.sys.idea.findMany({ include: { _count: { select: { votes: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map((i) => ({ id: i.id, title: i.title, description: i.description, status: i.status, votes: i._count.votes, createdAt: i.createdAt }));
  }
  async createIdea(input: { title: string; description?: string }) {
    const i = await this.prisma.sys.idea.create({ data: { title: input.title, description: input.description ?? '' } });
    return { id: i.id };
  }
  async updateIdea(id: string, input: { title?: string; description?: string; status?: 'UNDER_REVIEW' | 'PLANNED' | 'SHIPPED' | 'DECLINED' }) {
    await this.prisma.sys.idea.update({ where: { id }, data: input });
    return { ok: true };
  }

  // ---------- Affiliates ----------
  async affiliates() {
    const rows = await this.prisma.sys.affiliate.findMany({
      include: {
        account: { select: { email: true } },
        demoTenant: { select: { slug: true } },
        _count: { select: { referrals: true } },
        commissions: { select: { amount: true, status: true, currency: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const since = new Date(Date.now() - 30 * 86_400_000);
    const clicks = await this.prisma.sys.referralClick.groupBy({ by: ['affiliateId'], where: { createdAt: { gt: since } }, _count: { _all: true } });
    const paying = await this.prisma.sys.tenant.groupBy({
      by: ['referredByAffiliateId'],
      where: { referredByAffiliateId: { not: null }, status: { in: ['ACTIVE', 'PAST_DUE'] } },
      _count: { _all: true },
    });
    return rows.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.account.email,
      code: a.code,
      status: a.status,
      commissionPercent: a.commissionPercent,
      commissionMonths: a.commissionMonths,
      payoutsEnabled: a.payoutsEnabled,
      stripeConnected: !!a.stripeAccountId,
      demoUrl: a.demoTenant ? `${config.appUrl}/demo/${a.code}` : null,
      referrals: a._count.referrals,
      paying: paying.find((p) => p.referredByAffiliateId === a.id)?._count._all ?? 0,
      clicks30: clicks.find((c) => c.affiliateId === a.id)?._count._all ?? 0,
      pending: a.commissions.filter((c) => c.status === 'PENDING').reduce((s, c) => s + num(c.amount), 0),
      paid: a.commissions.filter((c) => c.status === 'PAID').reduce((s, c) => s + num(c.amount), 0),
      currency: a.commissions[0]?.currency ?? 'SEK',
    }));
  }

  async createAffiliate(input: { name: string; email: string; code?: string; commissionPercent?: number; commissionMonths?: number }) {
    const code = (input.code?.trim() || slugify(input.name)).slice(0, 30);
    if (!/^[a-z0-9-]{3,30}$/.test(code)) throw badRequest('Use 3–30 lowercase letters, numbers or dashes for the code');
    if (await this.prisma.sys.affiliate.findUnique({ where: { code } })) throw badRequest('That code is taken');
    let account = await this.prisma.sys.account.findUnique({ where: { email: input.email } });
    if (account?.isDemo) throw badRequest('That email belongs to a demo account');
    if (account && (await this.prisma.sys.affiliate.findUnique({ where: { accountId: account.id } }))) throw badRequest('That person is already a partner');
    const isNew = !account;
    if (!account) account = await this.prisma.sys.account.create({ data: { email: input.email, name: input.name } });
    const aff = await this.prisma.sys.affiliate.create({
      data: {
        accountId: account.id,
        code,
        name: input.name,
        commissionPercent: input.commissionPercent ?? config.affiliate.commissionPercent,
        commissionMonths: input.commissionMonths ?? config.affiliate.commissionMonths,
      },
    });
    let demoSlug = `demo-${code}`.slice(0, 40);
    if (await this.prisma.sys.tenant.findUnique({ where: { slug: demoSlug } })) demoSlug = `${demoSlug}-${Date.now().toString(36)}`.slice(0, 40);
    await this.demo.createDemoTenant(demoSlug, 'Nordvik Logistics (demo)', aff.id);
    if (isNew) {
      await this.auth.sendReset(
        account.id,
        account.email,
        'Welcome to the Lockred partner program',
        `Hi ${input.name.split(' ')[0]},\n\nYou’re now a Lockred partner. Your referral code is ${code} and you have your own demo portal that resets on the 1st of every month.\n\nChoose a password to open your partner portal. The link works for 7 days.`,
        24 * 7,
      );
    } else {
      await this.mail.send({
        to: account.email,
        subject: 'Welcome to the Lockred partner program',
        text: `You’re now a Lockred partner. Your referral code is ${code}. Sign in with your existing account to open the partner portal.`,
        action: { label: 'Open the partner portal', url: `${config.appUrl}/partners` },
      });
    }
    return { id: aff.id, code };
  }

  async updateAffiliate(id: string, input: { name?: string; status?: 'ACTIVE' | 'PAUSED'; commissionPercent?: number; commissionMonths?: number }) {
    await this.prisma.sys.affiliate.update({ where: { id }, data: input });
    return { ok: true };
  }

  /** Transfers all pending commission to the partner's connected Stripe account. */
  async payout(id: string) {
    const aff = await this.prisma.sys.affiliate.findUniqueOrThrow({ where: { id } });
    if (!aff.stripeAccountId || !aff.payoutsEnabled) throw badRequest('This partner hasn’t finished connecting a payout account in Stripe');
    const pending = await this.prisma.sys.commission.findMany({ where: { affiliateId: id, status: 'PENDING' } });
    if (!pending.length) throw badRequest('Nothing to pay out');
    const byCurrency = new Map<string, typeof pending>();
    for (const c of pending) byCurrency.set(c.currency, [...(byCurrency.get(c.currency) ?? []), c]);
    const results: { currency: string; amount: number; transferId: string }[] = [];
    for (const [currency, rows] of byCurrency) {
      const amount = rows.reduce((s, c) => s + num(c.amount), 0);
      const transfer = await this.stripe.s.transfers.create({
        amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        destination: aff.stripeAccountId,
        metadata: { affiliateId: id, commissions: String(rows.length) },
      });
      await this.prisma.sys.commission.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { status: 'PAID', paidAt: new Date(), transferId: transfer.id },
      });
      results.push({ currency, amount, transferId: transfer.id });
    }
    return { transfers: results };
  }

  // ---------- Demos ----------
  async demos() {
    const rows = await this.prisma.sys.tenant.findMany({ where: { isDemo: true }, include: { demoOf: { select: { name: true, code: true } } }, orderBy: { createdAt: 'asc' } });
    const lastResets = await this.prisma.sys.projectSnapshot.groupBy({ by: ['tenantId'], where: { tenantId: { in: rows.map((r) => r.id) } }, _max: { date: true } });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      affiliate: t.demoOf,
      entryUrl: t.demoOf ? `${config.appUrl}/demo/${t.demoOf.code}` : `${config.appUrl}/demo`,
      nextReset: nextDemoReset(),
      lastActivity: lastResets.find((l) => l.tenantId === t.id)?._max.date ?? null,
    }));
  }

  resetDemo(id: string) {
    return this.demo.reset(id).then(() => ({ ok: true }));
  }

  // ---------- Operators ----------
  async operators() {
    const rows = await this.prisma.sys.account.findMany({ where: { isOperator: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((a) => ({ id: a.id, name: a.name, email: a.email, mfa: a.totpEnabled, lastLoginAt: a.lastLoginAt }));
  }

  async addOperator(input: { name: string; email: string }) {
    let account = await this.prisma.sys.account.findUnique({ where: { email: input.email } });
    if (account?.isDemo) throw badRequest('That email belongs to a demo account');
    if (account) {
      await this.prisma.sys.account.update({ where: { id: account.id }, data: { isOperator: true } });
    } else {
      account = await this.prisma.sys.account.create({ data: { email: input.email, name: input.name, isOperator: true } });
      await this.auth.sendReset(account.id, account.email, 'You’re now a Lockred operator', 'Choose a password, then set up 2-step sign-in to open the operator console. The link works for 24 hours.', 24);
    }
    return { ok: true };
  }

  async removeOperator(ctx: Ctx, id: string) {
    if (id === ctx.accountId) throw badRequest('You can’t remove yourself');
    const count = await this.prisma.sys.account.count({ where: { isOperator: true } });
    if (count <= 1) throw badRequest('There must be at least one operator');
    await this.prisma.sys.account.update({ where: { id }, data: { isOperator: false } });
    await this.prisma.sys.session.deleteMany({ where: { accountId: id } });
    return { ok: true };
  }

  // ---------- System ----------
  async system() {
    const started = Date.now();
    let db = 'ok';
    try {
      await this.prisma.sys.$queryRaw`SELECT 1`;
    } catch (e) {
      db = (e as Error).message;
    }
    const dbMs = Date.now() - started;
    let backup: { file: string; at: Date; size: number } | null = null;
    if (config.backupDir) {
      try {
        const files = (await fs.readdir(config.backupDir)).filter((f) => f.endsWith('.sql.gz'));
        const stats = await Promise.all(files.map(async (f) => ({ f, s: await fs.stat(join(config.backupDir, f)) })));
        stats.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
        if (stats[0]) backup = { file: stats[0].f, at: stats[0].s.mtime, size: stats[0].s.size };
      } catch {
        backup = null;
      }
    }
    const lastStripe = await this.prisma.sys.stripeEvent.findFirst({ orderBy: { processedAt: 'desc' } });
    const [tenants, accounts, projects, tasks] = await Promise.all([
      this.prisma.sys.tenant.count(),
      this.prisma.sys.account.count({ where: { isDemo: false } }),
      this.prisma.sys.project.count(),
      this.prisma.sys.task.count(),
    ]);
    return {
      version: process.env.APP_VERSION ?? '1.0.0',
      uptimeSeconds: Math.round(process.uptime()),
      database: { status: db, latencyMs: dbMs },
      backup,
      stripe: { configured: this.stripe.enabled, lastWebhookAt: lastStripe?.processedAt ?? null },
      email: { configured: !!config.smtp.host },
      counts: { tenants, accounts, projects, tasks },
    };
  }
}

const zStatus = z.enum(['OPEN', 'WAITING_ON_CUSTOMER', 'PLANNED', 'RESOLVED', 'CLOSED']);

@Controller('ops')
@UseGuards(OperatorGuard)
export class OpsController {
  constructor(private ops: OpsService) {}

  @Get('overview') overview() { return this.ops.overview(); }

  @Get('tenants') tenants(@Query('q') q?: string) { return this.ops.tenants(q); }

  @Post('tenants')
  createTenant(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(
      z.object({
        name: zName,
        slug: z.string().trim().toLowerCase().max(40).optional(),
        adminEmail: zEmail,
        adminName: zName,
        plan: z.enum(['STARTER', 'TEAM', 'BUSINESS']).default('TEAM'),
        seats: z.number().int().min(1).max(10_000).default(10),
        trialDays: z.number().int().min(0).max(365).default(config.trialDays),
      }),
      body,
    );
    return this.ops.createTenant(ctx, b);
  }

  @Get('tenants/:id') tenant(@CurrentCtx() ctx: Ctx, @Param('id') id: string) { return this.ops.tenant(ctx, id); }

  @Patch('tenants/:id')
  updateTenant(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(
      z.object({
        name: zName.optional(),
        status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']).optional(),
        plan: z.enum(['STARTER', 'TEAM', 'BUSINESS', 'DEMO']).optional(),
        seats: z.number().int().min(1).max(10_000).optional(),
        trialEndsAt: z.string().datetime().nullable().optional(),
      }),
      body,
    );
    return this.ops.updateTenant(ctx, id, b);
  }

  @Delete('tenants/:id')
  deleteTenant(@Param('id') id: string, @Query('confirm') confirm: string) { return this.ops.deleteTenant(id, confirm ?? ''); }

  @Get('tickets') tickets(@Query('status') status?: string) { return this.ops.tickets(status); }
  @Get('tickets/:id') ticket(@Param('id') id: string) { return this.ops.ticket(id); }

  @Post('tickets/:id/messages')
  reply(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ body: z.string().trim().min(1).max(20_000), status: zStatus.optional() }), body);
    return this.ops.replyTicket(ctx, id, b.body, b.status);
  }

  @Patch('tickets/:id')
  setStatus(@Param('id') id: string, @Body() body: unknown) {
    return this.ops.setTicketStatus(id, parse(z.object({ status: zStatus }), body).status);
  }

  @Post('tickets/:id/idea') toIdea(@Param('id') id: string) { return this.ops.ticketToIdea(id); }

  @Get('ideas') ideas() { return this.ops.ideas(); }
  @Post('ideas')
  createIdea(@Body() body: unknown) {
    return this.ops.createIdea(parse(z.object({ title: z.string().trim().min(3).max(200), description: z.string().max(5000).optional() }), body));
  }
  @Patch('ideas/:id')
  updateIdea(@Param('id') id: string, @Body() body: unknown) {
    return this.ops.updateIdea(
      id,
      parse(
        z.object({
          title: z.string().trim().min(3).max(200).optional(),
          description: z.string().max(5000).optional(),
          status: z.enum(['UNDER_REVIEW', 'PLANNED', 'SHIPPED', 'DECLINED']).optional(),
        }),
        body,
      ),
    );
  }

  @Get('affiliates') affiliates() { return this.ops.affiliates(); }
  @Post('affiliates')
  createAffiliate(@Body() body: unknown) {
    const b = parse(
      z.object({
        name: zName,
        email: zEmail,
        code: z.string().trim().toLowerCase().max(30).optional(),
        commissionPercent: z.number().int().min(0).max(100).optional(),
        commissionMonths: z.number().int().min(1).max(120).optional(),
      }),
      body,
    );
    return this.ops.createAffiliate(b);
  }
  @Patch('affiliates/:id')
  updateAffiliate(@Param('id') id: string, @Body() body: unknown) {
    const b = parse(
      z.object({
        name: zName.optional(),
        status: z.enum(['ACTIVE', 'PAUSED']).optional(),
        commissionPercent: z.number().int().min(0).max(100).optional(),
        commissionMonths: z.number().int().min(1).max(120).optional(),
      }),
      body,
    );
    return this.ops.updateAffiliate(id, b);
  }
  @Post('affiliates/:id/payout') @HttpCode(200) payout(@Param('id') id: string) { return this.ops.payout(id); }

  @Get('demos') demos() { return this.ops.demos(); }
  @Post('demos/:id/reset') @HttpCode(200) resetDemo(@Param('id') id: string) { return this.ops.resetDemo(id); }

  @Get('operators') operators() { return this.ops.operators(); }
  @Post('operators')
  addOperator(@Body() body: unknown) { return this.ops.addOperator(parse(z.object({ name: zName, email: zEmail }), body)); }
  @Delete('operators/:id')
  removeOperator(@CurrentCtx() ctx: Ctx, @Param('id') id: string) { return this.ops.removeOperator(ctx, id); }

  @Get('system') system() { return this.ops.system(); }
}
