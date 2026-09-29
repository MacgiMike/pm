import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { config, stripeEnabled } from '../config';
import { badRequest } from '../core/util';

/** Thin wrapper so the rest of the code doesn't care whether Stripe is configured. */
@Injectable()
export class StripeService {
  private readonly log = new Logger('Stripe');
  private client: Stripe | null = stripeEnabled() ? new Stripe(config.stripe.secretKey) : null;
  private priceCache = new Map<string, { amount: number; currency: string; interval: string; at: number }>();

  get enabled() {
    return !!this.client;
  }

  get s(): Stripe {
    if (!this.client) throw badRequest('Billing is not configured on this server');
    return this.client;
  }

  planForPrice(priceId: string | undefined | null): 'STARTER' | 'TEAM' | 'BUSINESS' | null {
    if (!priceId) return null;
    for (const [plan, id] of Object.entries(config.stripe.prices)) if (id && id === priceId) return plan as 'STARTER' | 'TEAM' | 'BUSINESS';
    return null;
  }

  async price(priceId: string) {
    const cached = this.priceCache.get(priceId);
    if (cached && Date.now() - cached.at < 3_600_000) return cached;
    try {
      const p = await this.s.prices.retrieve(priceId);
      const v = { amount: (p.unit_amount ?? 0) / 100, currency: p.currency.toUpperCase(), interval: p.recurring?.interval ?? 'month', at: Date.now() };
      this.priceCache.set(priceId, v);
      return v;
    } catch (e) {
      this.log.warn(`Could not load price ${priceId}: ${(e as Error).message}`);
      return null;
    }
  }

  constructEvent(raw: Buffer | undefined, signature: string | undefined): Stripe.Event {
    if (!raw || !signature || !config.stripe.webhookSecret) throw new BadRequestException('Missing signature');
    try {
      return this.s.webhooks.constructEvent(raw, signature, config.stripe.webhookSecret);
    } catch (e) {
      throw new BadRequestException(`Webhook signature check failed: ${(e as Error).message}`);
    }
  }
}
