import { Body, Controller, Get, HttpCode, Injectable, Logger, OnApplicationBootstrap, Param, Post, Req, Res } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { config } from '../config';
import { DEFAULT_SETTINGS, readSettings } from '../core/context';
import { AppRequest, clientIp, Public } from '../core/guards';
import { PrismaService } from '../core/prisma.service';
import { StorageService } from '../core/storage.service';
import { newGuidToken } from '../core/tokens';
import { notFound, parse } from '../core/util';
import { ReportsService } from '../reports/reports';
import { DEMO_PEOPLE, DemoPeople, seedDemo } from './seed';

export const PUBLIC_DEMO_SLUG = 'nordvik-demo';

/** Next reset: the 1st of next month, 03:00 in the configured time zone (approximated in UTC+offset). */
export function nextDemoReset(now = new Date()): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 1, 1, 0, 0));
}

@Injectable()
export class DemoService implements OnApplicationBootstrap {
  private readonly log = new Logger('Demo');
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private storage: StorageService,
    private reports: ReportsService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.ensurePublicDemo();
    } catch (e) {
      this.log.error(`Could not prepare the public demo: ${(e as Error).message}`);
    }
  }

  async ensurePublicDemo() {
    const t = await this.prisma.sys.tenant.findUnique({ where: { slug: PUBLIC_DEMO_SLUG } });
    if (t) return t;
    const created = await this.createDemoTenant(PUBLIC_DEMO_SLUG, 'Nordvik Logistics (demo)', null);
    this.log.log('Public demo created');
    return created;
  }

  async createDemoTenant(slug: string, name: string, affiliateId: string | null) {
    const tenant = await this.prisma.sys.tenant.create({
      data: {
        slug,
        name,
        status: 'ACTIVE',
        plan: 'DEMO',
        seats: 1000,
        isDemo: true,
        demoAffiliateId: affiliateId,
        settings: DEFAULT_SETTINGS as unknown as Prisma.InputJsonValue,
      },
    });
    await this.reset(tenant.id);
    return tenant;
  }

  private async demoPeople(tenantId: string, slug: string): Promise<DemoPeople> {
    const people: DemoPeople = {};
    for (const p of DEMO_PEOPLE) {
      const email = `${p.key}.${slug}@demo.lockred.invalid`;
      const account = await this.prisma.sys.account.upsert({
        where: { email },
        create: { email, name: p.name, isDemo: true },
        update: { name: p.name },
      });
      await this.prisma.sys.membership.upsert({
        where: { tenantId_accountId: { tenantId, accountId: account.id } },
        create: { tenantId, accountId: account.id, role: p.role },
        update: { role: p.role, status: 'ACTIVE' },
      });
      people[p.key] = { id: account.id, name: p.name };
    }
    return people;
  }

  /** Wipes everything in a demo tenant and seeds it again. */
  async reset(tenantId: string) {
    const tenant = await this.prisma.sys.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (!tenant.isDemo) throw new Error('Refusing to reset a non-demo tenant');
    const people = await this.demoPeople(tenant.id, tenant.slug);
    // Remove anyone who isn't one of the demo people (should not happen, but keep demos clean).
    await this.prisma.sys.membership.deleteMany({ where: { tenantId, account: { isDemo: false } } });
    const guestToken = newGuidToken();
    const files = await this.prisma.tenant(tenantId, async (tx) => {
      const f = await tx.fileObject.findMany({ select: { storageKey: true } });
      await tx.cost.deleteMany({});
      await tx.project.deleteMany({});
      await tx.invite.deleteMany({});
      await tx.ticket.deleteMany({});
      await tx.auditLog.deleteMany({});
      await seedDemo(tx, tenantId, people, guestToken);
      await this.reports.snapshotTenant(tx);
      return f;
    });
    await this.prisma.sys.tenant.update({
      where: { id: tenantId },
      data: { settings: { ...readSettings(tenant.settings), demoGuestToken: guestToken } as unknown as Prisma.InputJsonValue },
    });
    await this.prisma.sys.session.deleteMany({ where: { tenantId, account: { isDemo: true } } });
    for (const f of files) await this.storage.remove(f.storageKey);
    this.log.log(`Demo ${tenant.slug} reset`);
  }

  @Cron('0 3 1 * *', { timeZone: config.timezone })
  async monthlyReset() {
    if (config.disableCron) return;
    const demos = await this.prisma.sys.tenant.findMany({ where: { isDemo: true } });
    for (const d of demos) {
      try {
        await this.reset(d.id);
      } catch (e) {
        this.log.error(`Reset of ${d.slug} failed: ${(e as Error).message}`);
      }
    }
  }

  async findDemo(key: string) {
    if (key === 'public') return this.ensurePublicDemo();
    const aff = await this.prisma.sys.affiliate.findUnique({ where: { code: key }, include: { demoTenant: true } });
    if (!aff || aff.status !== 'ACTIVE' || !aff.demoTenant) throw notFound('Demo not found');
    return aff.demoTenant;
  }

  async info(key: string) {
    const t = await this.findDemo(key);
    const aff = t.demoAffiliateId ? await this.prisma.sys.affiliate.findUnique({ where: { id: t.demoAffiliateId } }) : null;
    return { name: t.name.replace(' (demo)', ''), slug: t.slug, sharedBy: aff?.name ?? null, affiliateCode: aff?.code ?? null, nextReset: nextDemoReset() };
  }

  async enter(res: Response, key: string, as: 'manager' | 'owner' | 'contributor' | 'guest', ip?: string, ua?: string) {
    const t = await this.findDemo(key);
    if (as === 'guest') {
      const token = readSettings(t.settings).demoGuestToken;
      if (!token) throw notFound('Demo is being prepared, try again in a minute');
      return { next: `/t/${token}` };
    }
    const personKey = as === 'manager' ? 'per' : as === 'owner' ? 'elin' : 'omar';
    const account = await this.prisma.sys.account.findUnique({ where: { email: `${personKey}.${t.slug}@demo.lockred.invalid` } });
    if (!account) throw notFound('Demo is being prepared, try again in a minute');
    await this.auth.startSession(res, account, { tenantId: t.id, ip, userAgent: ua, hours: 4 });
    if (as === 'owner') {
      const harbor = await this.prisma.tenant(t.id, (tx) => tx.project.findFirst({ where: { name: 'Harbor ERP rollout' } }));
      if (harbor) return { next: `/${t.slug}/p/${harbor.id}` };
    }
    return { next: `/${t.slug}` };
  }
}

@Controller('demo')
@Public()
export class DemoController {
  constructor(private demo: DemoService) {}

  @Get(':key')
  info(@Param('key') key: string) {
    return this.demo.info(key);
  }

  @Post(':key/enter')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  enter(@Param('key') key: string, @Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const b = parse(z.object({ as: z.enum(['manager', 'owner', 'contributor', 'guest']) }), body);
    // Remember which partner's demo this was, so a trial started afterwards is attributed.
    return this.demo.enter(res, key, b.as, clientIp(req), req.headers['user-agent']).then(async (r) => {
      if (key !== 'public') {
        res.cookie(config.refCookie, key, { httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/', maxAge: config.affiliate.cookieDays * 86_400_000 });
      }
      return r;
    });
  }
}
