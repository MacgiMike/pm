import { Body, Controller, Get, Headers, HttpCode, Injectable, Logger, Post, Req, UseGuards } from '@nestjs/common';
import { PlanTier, TenantStatus } from '@prisma/client';
import type Stripe from 'stripe';
import { z } from 'zod';
import { config } from '../config';
import { Ctx } from '../core/context';
import { AllowInactiveTenant, AppRequest, CurrentCtx, Public, Roles, TenantGuard } from '../core/guards';
import { MailService } from '../core/mail.service';
import { PrismaService } from '../core/prisma.service';
import { badRequest, forbidden, parse } from '../core/util';
import { StripeService } from './stripe.service';

const PLANS: { id: 'STARTER' | 'TEAM' | 'BUSINESS'; name: string; features: string[] }[] = [
  { id: 'STARTER', name: 'Starter', features: ['Up to 5 active projects', 'Task links for external people', 'Project reports'] },
  { id: 'TEAM', name: 'Team', features: ['Unlimited projects', 'Portfolio view and reports', 'Budget and invoice tracking', 'Weekly status emails'] },
  { id: 'BUSINESS', name: 'Business', features: ['Everything in Team', 'Audit log export', 'Priority support', 'Single sign-on when available'] },
];

export function mapStatus(s: string): TenantStatus {
  switch (s) {
    case 'active':
    case 'trialing':
      return 'ACTIVE';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'PAST_DUE';
    case 'paused':
      return 'SUSPENDED';
    default:
      return 'CANCELLED';
  }
}

@Injectable()
export class BillingService {
  private readonly log = new Logger('Billing');
  constructor(private prisma: PrismaService, private stripe: StripeService, private mail: MailService) {}

  private async tenant(ctx: Ctx) {
    return this.prisma.sys.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId! } });
  }

  async overview(ctx: Ctx) {
    const t = await this.tenant(ctx);
    const [active, pending] = await Promise.all([
      this.prisma.sys.membership.count({ where: { tenantId: t.id, status: 'ACTIVE' } }),
      this.prisma.sys.invite.count({ where: { tenantId: t.id, acceptedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    const base = {
      enabled: this.stripe.enabled,
      isDemo: t.isDemo,
      status: t.status,
      plan: t.plan,
      seats: t.seats,
      seatsUsed: active + pending,
      trialEndsAt: t.trialEndsAt,
      hasSubscription: !!t.stripeSubscriptionId,
      plans: [] as { id: string; name: string; features: string[]; price: { amount: number; currency: string; interval: string } | null }[],
      paymentMethod: null as null | { brand: string; last4: string; expMonth: number; expYear: number },
      invoices: [] as { id: string; number: string | null; date: Date; amount: number; currency: string; status: string | null; pdf: string | null; url: string | null }[],
    };
    if (!this.stripe.enabled) return base;
    for (const p of PLANS) {
      const priceId = config.stripe.prices[p.id];
      base.plans.push({ ...p, price: priceId ? await this.stripe.price(priceId) : null });
    }
    if (t.stripeCustomerId) {
      try {
        const customer = (await this.stripe.s.customers.retrieve(t.stripeCustomerId, {
          expand: ['invoice_settings.default_payment_method'],
        })) as Stripe.Customer | Stripe.DeletedCustomer;
        const pm = !('deleted' in customer && customer.deleted)
          ? ((customer as Stripe.Customer).invoice_settings?.default_payment_method as Stripe.PaymentMethod | null)
          : null;
        if (pm && typeof pm === 'object' && pm.card) {
          base.paymentMethod = { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
        }
        const invoices = await this.stripe.s.invoices.list({ customer: t.stripeCustomerId, limit: 12 });
        base.invoices = invoices.data.map((i) => ({
          id: i.id ?? '',
          number: i.number,
          date: new Date(i.created * 1000),
          amount: (i.total ?? 0) / 100,
          currency: i.currency.toUpperCase(),
          status: i.status,
          pdf: i.invoice_pdf ?? null,
          url: i.hosted_invoice_url ?? null,
        }));
      } catch (e) {
        this.log.warn(`Stripe lookup failed for ${t.slug}: ${(e as Error).message}`);
      }
    }
    return base;
  }

  private async ensureCustomer(ctx: Ctx) {
    const t = await this.tenant(ctx);
    if (t.stripeCustomerId) return t.stripeCustomerId;
    const c = await this.stripe.s.customers.create({
      email: ctx.account.email,
      name: t.name,
      metadata: { tenantId: t.id, slug: t.slug },
    });
    await this.prisma.sys.tenant.update({ where: { id: t.id }, data: { stripeCustomerId: c.id } });
    return c.id;
  }

  async checkout(ctx: Ctx, plan: 'STARTER' | 'TEAM' | 'BUSINESS', seats: number) {
    const t = await this.tenant(ctx);
    if (t.isDemo) throw forbidden('This is a demo');
    if (t.stripeSubscriptionId && t.status !== 'CANCELLED') {
      throw badRequest('You already have a subscription. Use “Manage billing” to change plan or payment method.');
    }
    const price = config.stripe.prices[plan];
    if (!price) throw badRequest('That plan is not available');
    const members = await this.prisma.sys.membership.count({ where: { tenantId: t.id, status: 'ACTIVE' } });
    const customer = await this.ensureCustomer(ctx);
    const session = await this.stripe.s.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price, quantity: Math.max(seats, members, 1) }],
      success_url: `${config.appUrl}/${t.slug}/billing?done=1`,
      cancel_url: `${config.appUrl}/${t.slug}/billing`,
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
      metadata: { tenantId: t.id },
      subscription_data: { metadata: { tenantId: t.id } },
    });
    return { url: session.url };
  }

  async portal(ctx: Ctx) {
    const t = await this.tenant(ctx);
    if (t.isDemo) throw forbidden('This is a demo');
    const customer = await this.ensureCustomer(ctx);
    const session = await this.stripe.s.billingPortal.sessions.create({ customer, return_url: `${config.appUrl}/${t.slug}/billing` });
    return { url: session.url };
  }

  async setSeats(ctx: Ctx, seats: number) {
    const t = await this.tenant(ctx);
    if (t.isDemo) throw forbidden('This is a demo');
    const [active, pending] = await Promise.all([
      this.prisma.sys.membership.count({ where: { tenantId: t.id, status: 'ACTIVE' } }),
      this.prisma.sys.invite.count({ where: { tenantId: t.id, acceptedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    if (seats < active + pending) throw badRequest(`You use ${active + pending} seats. Remove people or invitations first.`);
    if (!t.stripeSubscriptionId) {
      if (t.status === 'TRIAL') {
        await this.prisma.sys.tenant.update({ where: { id: t.id }, data: { seats } });
        return { seats };
      }
      throw badRequest('Choose a plan first');
    }
    const sub = await this.stripe.s.subscriptions.retrieve(t.stripeSubscriptionId);
    const item = sub.items.data[0];
    if (!item) throw badRequest('Subscription has no items');
    await this.stripe.s.subscriptions.update(sub.id, {
      items: [{ id: item.id, quantity: seats }],
      proration_behavior: 'create_prorations',
    });
    await this.prisma.sys.tenant.update({ where: { id: t.id }, data: { seats } });
    await this.prisma.sys.auditLog.create({
      data: { tenantId: t.id, actorAccountId: ctx.accountId, actorName: ctx.account.name, action: 'billing.seats', data: { seats } },
    });
    return { seats };
  }

  // ---------- Webhooks ----------
  async handle(event: Stripe.Event) {
    const seen = await this.prisma.sys.stripeEvent.findUnique({ where: { id: event.id } });
    if (seen) return;
    const obj = event.data.object as any;
    switch (event.type) {
      case 'checkout.session.completed': {
        const tenantId = obj.metadata?.tenantId as string | undefined;
        if (tenantId && obj.subscription) {
          await this.prisma.sys.tenant.update({
            where: { id: tenantId },
            data: { stripeCustomerId: obj.customer ?? undefined, stripeSubscriptionId: String(obj.subscription) },
          });
          const sub = await this.stripe.s.subscriptions.retrieve(String(obj.subscription));
          await this.applySubscription(sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.applySubscription(obj as Stripe.Subscription);
        break;
      case 'invoice.paid':
        await this.onInvoicePaid(obj);
        break;
      case 'invoice.payment_failed': {
        const t = obj.customer ? await this.prisma.sys.tenant.findUnique({ where: { stripeCustomerId: String(obj.customer) } }) : null;
        if (t && t.status === 'ACTIVE') {
          await this.prisma.sys.tenant.update({ where: { id: t.id }, data: { status: 'PAST_DUE' } });
          const admins = await this.prisma.sys.membership.findMany({ where: { tenantId: t.id, role: 'ADMIN', status: 'ACTIVE' }, include: { account: true } });
          for (const a of admins) {
            await this.mail.send({
              to: a.account.email,
              subject: `Payment failed for ${t.name}`,
              text: `We couldn’t charge the card on file for your Lockred subscription. Stripe will try again automatically. Please update your payment method to avoid interruption.`,
              action: { label: 'Update payment method', url: `${config.appUrl}/${t.slug}/billing` },
            });
          }
        }
        break;
      }
      case 'account.updated': {
        const acct = obj as Stripe.Account;
        await this.prisma.sys.affiliate.updateMany({
          where: { stripeAccountId: acct.id },
          data: { payoutsEnabled: !!acct.payouts_enabled },
        });
        break;
      }
      default:
        break;
    }
    await this.prisma.sys.stripeEvent.create({ data: { id: event.id, type: event.type } });
  }

  private async applySubscription(sub: Stripe.Subscription) {
    const tenantId = (sub.metadata?.tenantId as string | undefined) ?? undefined;
    const t = tenantId
      ? await this.prisma.sys.tenant.findUnique({ where: { id: tenantId } })
      : await this.prisma.sys.tenant.findUnique({ where: { stripeCustomerId: String(sub.customer) } });
    if (!t) {
      this.log.warn(`Subscription ${sub.id} has no matching tenant`);
      return;
    }
    const item = sub.items?.data?.[0];
    const plan = this.stripe.planForPrice(item?.price?.id) as PlanTier | null;
    const status = mapStatus(sub.status);
    await this.prisma.sys.tenant.update({
      where: { id: t.id },
      data: {
        status,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: String(sub.customer),
        plan: plan ?? t.plan,
        seats: item?.quantity ?? t.seats,
        cancelledAt: status === 'CANCELLED' ? new Date() : null,
      },
    });
    await this.prisma.sys.auditLog.create({
      data: { tenantId: t.id, actorName: 'Stripe', action: 'billing.subscription', data: { status: sub.status, plan, seats: item?.quantity ?? null } },
    });
  }

  private async onInvoicePaid(inv: any) {
    if (!inv.customer || !inv.id) return;
    const t = await this.prisma.sys.tenant.findUnique({ where: { stripeCustomerId: String(inv.customer) } });
    if (!t) return;
    if (t.status === 'PAST_DUE') await this.prisma.sys.tenant.update({ where: { id: t.id }, data: { status: 'ACTIVE' } });
    if (!t.referredByAffiliateId) return;
    const aff = await this.prisma.sys.affiliate.findUnique({ where: { id: t.referredByAffiliateId } });
    if (!aff || aff.status !== 'ACTIVE') return;
    const first = await this.prisma.sys.commission.findFirst({ where: { tenantId: t.id }, orderBy: { createdAt: 'asc' } });
    if (first) {
      const until = new Date(first.createdAt);
      until.setMonth(until.getMonth() + aff.commissionMonths);
      if (new Date() > until) return;
    }
    const net = Number(inv.total_excluding_tax ?? inv.amount_paid ?? 0) / 100;
    if (net <= 0) return;
    const amount = Math.round(net * aff.commissionPercent) / 100;
    await this.prisma.sys.commission.upsert({
      where: { stripeInvoiceId: String(inv.id) },
      create: {
        affiliateId: aff.id,
        tenantId: t.id,
        stripeInvoiceId: String(inv.id),
        amount,
        currency: String(inv.currency ?? 'sek').toUpperCase(),
      },
      update: {},
    });
  }
}

@Controller('billing')
export class BillingController {
  constructor(private billing: BillingService, private stripe: StripeService) {}

  @Get()
  @UseGuards(TenantGuard)
  @Roles('ADMIN')
  @AllowInactiveTenant()
  overview(@CurrentCtx() ctx: Ctx) {
    return this.billing.overview(ctx);
  }

  @Post('checkout')
  @HttpCode(200)
  @UseGuards(TenantGuard)
  @Roles('ADMIN')
  @AllowInactiveTenant()
  checkout(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ plan: z.enum(['STARTER', 'TEAM', 'BUSINESS']), seats: z.number().int().min(1).max(10_000) }), body);
    return this.billing.checkout(ctx, b.plan, b.seats);
  }

  @Post('portal')
  @HttpCode(200)
  @UseGuards(TenantGuard)
  @Roles('ADMIN')
  @AllowInactiveTenant()
  portal(@CurrentCtx() ctx: Ctx) {
    return this.billing.portal(ctx);
  }

  @Post('seats')
  @HttpCode(200)
  @UseGuards(TenantGuard)
  @Roles('ADMIN')
  @AllowInactiveTenant()
  seats(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    return this.billing.setSeats(ctx, parse(z.object({ seats: z.number().int().min(1).max(10_000) }), body).seats);
  }

  @Post('webhook')
  @Public()
  @HttpCode(200)
  async webhook(@Req() req: AppRequest & { rawBody?: Buffer }, @Headers('stripe-signature') sig: string) {
    const event = this.stripe.constructEvent(req.rawBody, sig);
    await this.billing.handle(event);
    return { received: true };
  }
}
