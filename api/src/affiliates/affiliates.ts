import { Controller, Get, HttpCode, Injectable, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { config } from '../config';
import { AffiliateGuard, AppRequest, clientIp, Public } from '../core/guards';
import { PrismaService } from '../core/prisma.service';
import { hashIp } from '../core/tokens';
import { num } from '../core/util';
import { StripeService } from '../billing/stripe.service';
import { DemoService, nextDemoReset } from '../demo/demo';
import { forbidden } from '../core/util';

@Injectable()
export class AffiliatesService {
  constructor(private prisma: PrismaService, private stripe: StripeService, private demo: DemoService) {}

  async click(code: string, ip?: string) {
    const aff = await this.prisma.sys.affiliate.findUnique({ where: { code } });
    if (!aff || aff.status !== 'ACTIVE') return null;
    await this.prisma.sys.referralClick.create({ data: { affiliateId: aff.id, ipHash: hashIp(ip) } });
    return aff;
  }

  async dashboard(affiliateId: string) {
    const aff = await this.prisma.sys.affiliate.findUniqueOrThrow({ where: { id: affiliateId }, include: { demoTenant: true } });
    const since = new Date(Date.now() - 30 * 86_400_000);
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const [clicks30, referrals, commissions] = await Promise.all([
      this.prisma.sys.referralClick.count({ where: { affiliateId, createdAt: { gt: since } } }),
      this.prisma.sys.tenant.findMany({ where: { referredByAffiliateId: affiliateId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.sys.commission.findMany({ where: { affiliateId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const byTenant = new Map<string, number>();
    for (const c of commissions) if (c.status !== 'VOID') byTenant.set(c.tenantId, (byTenant.get(c.tenantId) ?? 0) + num(c.amount));
    const sum = (f: (c: (typeof commissions)[number]) => boolean) => commissions.filter(f).reduce((s, c) => s + num(c.amount), 0);
    const currency = commissions[0]?.currency ?? 'SEK';
    const lastPaid = commissions.find((c) => c.status === 'PAID');
    return {
      name: aff.name,
      code: aff.code,
      referralUrl: `${config.appUrl}/?ref=${aff.code}`,
      commissionPercent: aff.commissionPercent,
      commissionMonths: aff.commissionMonths,
      cookieDays: config.affiliate.cookieDays,
      payouts: { connected: !!aff.stripeAccountId, enabled: aff.payoutsEnabled, stripeConfigured: this.stripe.enabled },
      demo: aff.demoTenant
        ? { url: `${config.appUrl}/demo/${aff.code}`, slug: aff.demoTenant.slug, nextReset: nextDemoReset() }
        : null,
      stats: {
        clicks30,
        trials: referrals.filter((t) => t.status === 'TRIAL').length,
        paying: referrals.filter((t) => t.status === 'ACTIVE' || t.status === 'PAST_DUE').length,
        thisMonth: sum((c) => c.createdAt >= monthStart && c.status !== 'VOID'),
        pending: sum((c) => c.status === 'PENDING'),
        paid: sum((c) => c.status === 'PAID'),
        lastPaidAt: lastPaid?.paidAt ?? null,
        currency,
      },
      referrals: referrals.map((t) => ({
        name: t.name,
        since: t.createdAt,
        plan: t.plan,
        status: t.status,
        trialEndsAt: t.trialEndsAt,
        earned: byTenant.get(t.id) ?? 0,
      })),
    };
  }

  async connect(affiliateId: string) {
    const aff = await this.prisma.sys.affiliate.findUniqueOrThrow({ where: { id: affiliateId }, include: { account: true } });
    let acct = aff.stripeAccountId;
    if (!acct) {
      const created = await this.stripe.s.accounts.create({
        type: 'express',
        email: aff.account.email,
        metadata: { affiliateId: aff.id },
        capabilities: { transfers: { requested: true } },
      });
      acct = created.id;
      await this.prisma.sys.affiliate.update({ where: { id: aff.id }, data: { stripeAccountId: acct } });
    }
    const link = await this.stripe.s.accountLinks.create({
      account: acct,
      refresh_url: `${config.appUrl}/partners?connect=retry`,
      return_url: `${config.appUrl}/partners?connect=done`,
      type: 'account_onboarding',
    });
    return { url: link.url };
  }

  async resetDemo(affiliateId: string) {
    const aff = await this.prisma.sys.affiliate.findUniqueOrThrow({ where: { id: affiliateId }, include: { demoTenant: true } });
    if (!aff.demoTenant) throw forbidden('You don’t have a demo portal yet');
    await this.demo.reset(aff.demoTenant.id);
    return { ok: true };
  }
}

@Controller()
export class AffiliatesController {
  constructor(private affiliates: AffiliatesService) {}

  /** Referral link: records the click, remembers the partner for N days, sends the visitor on. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('r/:code')
  async referral(@Param('code') code: string, @Query('to') to: string | undefined, @Req() req: AppRequest, @Res() res: Response) {
    const aff = await this.affiliates.click(code, clientIp(req));
    if (aff) {
      res.cookie(config.refCookie, aff.code, {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'lax',
        path: '/',
        maxAge: config.affiliate.cookieDays * 86_400_000,
      });
    }
    const target = to && /^\/(?![\/\\])[\w\-\/?=&.%]*$/.test(to) ? to : '/signup';
    res.redirect(302, target);
  }

  @Get('partners/me')
  @UseGuards(AffiliateGuard)
  me(@Req() req: AppRequest) {
    return this.affiliates.dashboard(req.affiliateId!);
  }

  @Post('partners/connect')
  @HttpCode(200)
  @UseGuards(AffiliateGuard)
  connect(@Req() req: AppRequest) {
    return this.affiliates.connect(req.affiliateId!);
  }

  @Post('partners/demo/reset')
  @HttpCode(200)
  @UseGuards(AffiliateGuard)
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  resetDemo(@Req() req: AppRequest) {
    return this.affiliates.resetDemo(req.affiliateId!);
  }
}
