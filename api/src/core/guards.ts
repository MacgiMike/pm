import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantRole } from '@prisma/client';
import type { Request } from 'express';
import { config, stripeEnabled } from '../config';
import { Ctx, readSettings } from './context';
import { PrismaService } from './prisma.service';
import { sha256 } from './tokens';

export const IS_PUBLIC = 'lr:public';
export const ALLOW_MFA_PENDING = 'lr:mfaPending';
export const TENANT_ROLES = 'lr:roles';
export const ALLOW_INACTIVE = 'lr:allowInactive';

/** No session required (a session is still read if present). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Reachable after password but before the 2-step code. */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING, true);
/** Restrict to tenant roles (checked by TenantGuard). */
export const Roles = (...roles: TenantRole[]) => SetMetadata(TENANT_ROLES, roles);
/** Reachable even when the subscription is inactive (billing, export). */
export const AllowInactiveTenant = () => SetMetadata(ALLOW_INACTIVE, true);

export type AppRequest = Request & { ctx?: Ctx; affiliateId?: string };

export const CurrentCtx = createParamDecorator((_: unknown, ec: ExecutionContext): Ctx => {
  const req = ec.switchToHttp().getRequest<AppRequest>();
  if (!req.ctx) throw new UnauthorizedException();
  return req.ctx;
});

export function clientIp(req: Request): string | undefined {
  return (req.ip || req.socket?.remoteAddress || undefined)?.replace(/^::ffff:/, '');
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const targets = [ec.getHandler(), ec.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_PENDING, targets);
    const req = ec.switchToHttp().getRequest<AppRequest>();
    const token: string | undefined = (req as any).cookies?.[config.sessionCookie];

    if (token) {
      const session = await this.prisma.sys.session.findUnique({
        where: { tokenHash: sha256(token) },
        include: { account: true },
      });
      if (session && session.expiresAt > new Date() && (!session.mfaPending || allowPending)) {
        req.ctx = {
          sessionId: session.id,
          accountId: session.accountId,
          account: {
            id: session.account.id,
            name: session.account.name,
            email: session.account.email,
            isOperator: session.account.isOperator,
            totpEnabled: session.account.totpEnabled,
            isDemo: session.account.isDemo,
          },
          tenantId: session.tenantId,
          ip: clientIp(req),
        };
        // Sliding expiry, written at most every 5 minutes.
        if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
          const hours = session.account.isDemo ? 4 : 12;
          await this.prisma.sys.session.update({
            where: { id: session.id },
            data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + hours * 3_600_000) },
          });
        }
      }
    }

    if (isPublic) return true;
    if (!req.ctx) throw new UnauthorizedException('Please sign in');
    return true;
  }
}

/** Requires an active membership in the session's current tenant. */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const req = ec.switchToHttp().getRequest<AppRequest>();
    const ctx = req.ctx;
    if (!ctx) throw new UnauthorizedException('Please sign in');
    if (!ctx.tenantId) {
      throw new HttpException({ message: 'Choose an organization first', code: 'NO_TENANT' }, HttpStatus.CONFLICT);
    }
    const membership = await this.prisma.sys.membership.findUnique({
      where: { tenantId_accountId: { tenantId: ctx.tenantId, accountId: ctx.accountId } },
      include: { tenant: true },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new HttpException({ message: 'You are not a member of this organization', code: 'NOT_MEMBER' }, HttpStatus.FORBIDDEN);
    }
    const t = membership.tenant;
    ctx.tenantRole = membership.role;
    ctx.tenant = {
      id: t.id,
      slug: t.slug,
      name: t.name,
      isDemo: t.isDemo,
      status: t.status,
      settings: readSettings(t.settings),
      currency: t.currency,
      timezone: t.timezone,
    };

    const targets = [ec.getHandler(), ec.getClass()];
    const allowInactive = this.reflector.getAllAndOverride<boolean>(ALLOW_INACTIVE, targets);
    if (!allowInactive && !isTenantUsable(t)) {
      throw new HttpException(
        { message: 'The subscription for this organization is not active', code: 'SUBSCRIPTION_INACTIVE' },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const roles = this.reflector.getAllAndOverride<TenantRole[]>(TENANT_ROLES, targets);
    if (roles?.length && !roles.includes(membership.role)) {
      throw new HttpException({ message: 'Only ' + roles.join(' or ').toLowerCase() + 's can do this' }, HttpStatus.FORBIDDEN);
    }
    if (
      roles?.includes('ADMIN') &&
      membership.role === 'ADMIN' &&
      ctx.tenant.settings.require2faForAdmins &&
      !ctx.account.totpEnabled &&
      !t.isDemo
    ) {
      throw new HttpException(
        { message: 'Set up 2-step sign-in to use admin settings', code: 'MFA_SETUP_REQUIRED' },
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}

export function isTenantUsable(t: { status: string; trialEndsAt: Date | null; isDemo: boolean }): boolean {
  if (t.isDemo) return true;
  if (t.status === 'SUSPENDED' || t.status === 'CANCELLED') return false;
  if (!stripeEnabled()) return true;
  if (t.status === 'ACTIVE' || t.status === 'PAST_DUE') return true;
  if (t.status === 'TRIAL') return !t.trialEndsAt || t.trialEndsAt > new Date();
  return false;
}

@Injectable()
export class OperatorGuard implements CanActivate {
  canActivate(ec: ExecutionContext): boolean {
    const ctx = ec.switchToHttp().getRequest<AppRequest>().ctx;
    if (!ctx?.account.isOperator) throw new HttpException('Operators only', HttpStatus.FORBIDDEN);
    if (config.operatorRequireMfa && !ctx.account.totpEnabled) {
      throw new HttpException(
        { message: 'Set up 2-step sign-in before using the operator console', code: 'MFA_SETUP_REQUIRED' },
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}

@Injectable()
export class AffiliateGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}
  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const req = ec.switchToHttp().getRequest<AppRequest>();
    if (!req.ctx) throw new UnauthorizedException();
    const aff = await this.prisma.sys.affiliate.findUnique({ where: { accountId: req.ctx.accountId } });
    if (!aff) throw new HttpException('Partners only', HttpStatus.FORBIDDEN);
    req.affiliateId = aff.id;
    return true;
  }
}
