import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Account, Prisma, TenantRole } from '@prisma/client';
import argon2 from 'argon2';
import type { Response } from 'express';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { config } from '../config';
import { Ctx, DEFAULT_SETTINGS, readSettings } from '../core/context';
import { decrypt, encrypt } from '../core/crypto';
import { isTenantUsable } from '../core/guards';
import { MailService } from '../core/mail.service';
import { PrismaService } from '../core/prisma.service';
import { isValidSlug } from '../core/slugs';
import { newToken, sha256 } from '../core/tokens';
import { addDays, badRequest, forbidden, notFound } from '../core/util';

authenticator.options = { window: 1 };

const INVALID_LOGIN = 'That email and password don’t match';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private mail: MailService) {}

  // ---------- passwords ----------
  hash(password: string) {
    return argon2.hash(password, { type: argon2.argon2id });
  }
  async verify(hash: string | null, password: string) {
    if (!hash) return false;
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
  checkPasswordStrength(pw: string) {
    if (pw.length < 10) throw badRequest('Use at least 10 characters for your password');
    if (pw.length > 200) throw badRequest('That password is too long');
  }

  // ---------- sessions ----------
  async startSession(
    res: Response,
    account: Account,
    opts: { tenantId?: string | null; mfaPending?: boolean; ip?: string; userAgent?: string; hours?: number },
  ) {
    const token = newToken();
    const hours = opts.hours ?? (account.isDemo ? 4 : 12);
    await this.prisma.sys.session.create({
      data: {
        tokenHash: sha256(token),
        accountId: account.id,
        tenantId: opts.tenantId ?? null,
        mfaPending: !!opts.mfaPending,
        expiresAt: new Date(Date.now() + (opts.mfaPending ? 0.25 : hours) * 3_600_000),
        ip: opts.ip ?? null,
        userAgent: opts.userAgent?.slice(0, 300) ?? null,
      },
    });
    res.cookie(config.sessionCookie, token, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 3_600_000,
    });
  }

  async endSession(res: Response, sessionId?: string) {
    if (sessionId) await this.prisma.sys.session.deleteMany({ where: { id: sessionId } });
    res.clearCookie(config.sessionCookie, { path: '/' });
  }

  /** The tenant to open after sign-in: the only one, or the one the session already had. */
  async defaultTenant(accountId: string): Promise<string | null> {
    const ms = await this.prisma.sys.membership.findMany({
      where: { accountId, status: 'ACTIVE' },
      select: { tenantId: true },
    });
    return ms.length === 1 ? ms[0].tenantId : null;
  }

  async landingPath(accountId: string, tenantId: string | null): Promise<string> {
    if (tenantId) {
      const t = await this.prisma.sys.tenant.findUnique({ where: { id: tenantId } });
      if (t) return `/${t.slug}`;
    }
    const [memberships, account, affiliate] = await Promise.all([
      this.prisma.sys.membership.count({ where: { accountId, status: 'ACTIVE' } }),
      this.prisma.sys.account.findUnique({ where: { id: accountId } }),
      this.prisma.sys.affiliate.findUnique({ where: { accountId } }),
    ]);
    if (memberships > 1) return '/select';
    if (account?.isOperator) return '/ops';
    if (affiliate) return '/partners';
    return '/select';
  }

  // ---------- login ----------
  async login(res: Response, email: string, password: string, ip?: string, ua?: string) {
    const account = await this.prisma.sys.account.findUnique({ where: { email: email.toLowerCase() } });
    const ok = account && !account.isDemo && (await this.verify(account.passwordHash, password));
    if (!ok || !account) {
      // Spend similar time whether or not the account exists.
      if (!account) await this.verify('$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG', password);
      throw new HttpException(INVALID_LOGIN, HttpStatus.UNAUTHORIZED);
    }
    const tenantId = await this.defaultTenant(account.id);
    if (account.totpEnabled) {
      await this.startSession(res, account, { tenantId, mfaPending: true, ip, userAgent: ua });
      return { mfaRequired: true };
    }
    await this.prisma.sys.account.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    await this.startSession(res, account, { tenantId, ip, userAgent: ua });
    return { mfaRequired: false, next: await this.landingPath(account.id, tenantId) };
  }

  async completeMfa(ctx: Ctx, code: string) {
    const account = await this.prisma.sys.account.findUniqueOrThrow({ where: { id: ctx.accountId } });
    if (!account.totpEnabled || !account.totpSecret) throw badRequest('2-step sign-in is not enabled');
    if (!authenticator.verify({ token: code.replace(/\s/g, ''), secret: decrypt(account.totpSecret) })) {
      throw new HttpException('That code didn’t work. Check the time on your phone and try again.', HttpStatus.UNAUTHORIZED);
    }
    await this.prisma.sys.session.update({
      where: { id: ctx.sessionId },
      data: { mfaPending: false, expiresAt: new Date(Date.now() + 12 * 3_600_000) },
    });
    await this.prisma.sys.account.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    return { next: await this.landingPath(account.id, ctx.tenantId) };
  }

  async mfaSetup(ctx: Ctx) {
    const account = await this.prisma.sys.account.findUniqueOrThrow({ where: { id: ctx.accountId } });
    if (account.isDemo) throw forbidden('Not available in the demo');
    if (account.totpEnabled) throw badRequest('2-step sign-in is already on');
    const secret = authenticator.generateSecret();
    await this.prisma.sys.account.update({ where: { id: account.id }, data: { totpSecret: encrypt(secret) } });
    const uri = authenticator.keyuri(account.email, 'Lockred', secret);
    return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
  }

  async mfaEnable(ctx: Ctx, code: string) {
    const account = await this.prisma.sys.account.findUniqueOrThrow({ where: { id: ctx.accountId } });
    if (!account.totpSecret) throw badRequest('Start the setup first');
    if (!authenticator.verify({ token: code.replace(/\s/g, ''), secret: decrypt(account.totpSecret) })) {
      throw badRequest('That code didn’t work. Try the newest code from your app.');
    }
    await this.prisma.sys.account.update({ where: { id: account.id }, data: { totpEnabled: true } });
    return { ok: true };
  }

  async mfaDisable(ctx: Ctx, code: string) {
    const account = await this.prisma.sys.account.findUniqueOrThrow({ where: { id: ctx.accountId } });
    if (!account.totpEnabled || !account.totpSecret) return { ok: true };
    if (!authenticator.verify({ token: code.replace(/\s/g, ''), secret: decrypt(account.totpSecret) })) {
      throw badRequest('That code didn’t work');
    }
    if (account.isOperator && config.operatorRequireMfa) throw forbidden('Operators must keep 2-step sign-in on');
    await this.prisma.sys.account.update({ where: { id: account.id }, data: { totpEnabled: false, totpSecret: null } });
    return { ok: true };
  }

  // ---------- me ----------
  async me(ctx: Ctx) {
    const [memberships, affiliate] = await Promise.all([
      this.prisma.sys.membership.findMany({
        where: { accountId: ctx.accountId, status: 'ACTIVE' },
        include: { tenant: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.sys.affiliate.findUnique({ where: { accountId: ctx.accountId } }),
    ]);
    const current = memberships.find((m) => m.tenantId === ctx.tenantId);
    const t = current?.tenant;
    const settings = t ? readSettings(t.settings) : null;
    return {
      account: {
        id: ctx.account.id,
        name: ctx.account.name,
        email: ctx.account.email,
        isOperator: ctx.account.isOperator,
        totpEnabled: ctx.account.totpEnabled,
        isDemo: ctx.account.isDemo,
      },
      tenants: memberships.map((m) => ({
        id: m.tenant.id,
        slug: m.tenant.slug,
        name: m.tenant.name,
        role: m.role,
        isDemo: m.tenant.isDemo,
      })),
      tenant: t
        ? {
            id: t.id,
            slug: t.slug,
            name: t.name,
            role: current!.role,
            isDemo: t.isDemo,
            status: t.status,
            plan: t.plan,
            trialEndsAt: t.trialEndsAt,
            currency: t.currency,
            usable: isTenantUsable(t),
            whoCanCreateProjects: settings!.whoCanCreateProjects,
            mfaSetupRequired: current!.role === 'ADMIN' && settings!.require2faForAdmins && !ctx.account.totpEnabled && !t.isDemo,
          }
        : null,
      affiliate: affiliate ? { code: affiliate.code, name: affiliate.name } : null,
      operatorMfaSetupRequired: ctx.account.isOperator && config.operatorRequireMfa && !ctx.account.totpEnabled,
    };
  }

  async switchTenant(ctx: Ctx, slug: string) {
    const t = await this.prisma.sys.tenant.findUnique({ where: { slug } });
    if (!t) throw notFound('Organization not found');
    const m = await this.prisma.sys.membership.findUnique({
      where: { tenantId_accountId: { tenantId: t.id, accountId: ctx.accountId } },
    });
    if (!m || m.status !== 'ACTIVE') throw forbidden('You are not a member of that organization');
    await this.prisma.sys.session.update({ where: { id: ctx.sessionId }, data: { tenantId: t.id } });
    return { ok: true, slug: t.slug };
  }

  // ---------- sign-up ----------
  async signup(
    res: Response,
    input: { company: string; slug: string; name: string; email: string; password: string },
    refCode: string | undefined,
    ip?: string,
    ua?: string,
  ) {
    this.checkPasswordStrength(input.password);
    if (!isValidSlug(input.slug)) throw badRequest('Pick another web address: use 3–40 lowercase letters, numbers or dashes');
    const email = input.email.toLowerCase();
    if (await this.prisma.sys.account.findUnique({ where: { email } })) {
      throw badRequest('There is already an account with that email. Sign in instead.');
    }
    if (await this.prisma.sys.tenant.findUnique({ where: { slug: input.slug } })) {
      throw badRequest('That web address is taken');
    }
    const affiliate = refCode
      ? await this.prisma.sys.affiliate.findFirst({ where: { code: refCode, status: 'ACTIVE' } })
      : null;
    const passwordHash = await this.hash(input.password);
    const { account, tenant } = await this.prisma.sys.$transaction(async (tx) => {
      const account = await tx.account.create({ data: { email, name: input.name.trim(), passwordHash } });
      const tenant = await tx.tenant.create({
        data: {
          slug: input.slug,
          name: input.company.trim(),
          status: 'TRIAL',
          plan: 'TEAM',
          seats: config.trialSeats,
          trialEndsAt: addDays(new Date(), config.trialDays),
          settings: DEFAULT_SETTINGS as unknown as Prisma.InputJsonValue,
          referredByAffiliateId: affiliate?.id ?? null,
        },
      });
      await tx.membership.create({ data: { tenantId: tenant.id, accountId: account.id, role: 'ADMIN' } });
      await tx.auditLog.create({
        data: { tenantId: tenant.id, actorAccountId: account.id, actorName: account.name, action: 'tenant.created' },
      });
      return { account, tenant };
    });
    await this.startSession(res, account, { tenantId: tenant.id, ip, userAgent: ua });
    await this.mail.send({
      to: email,
      subject: `Welcome to Lockred, ${account.name.split(' ')[0]}`,
      text: `Your organization ${tenant.name} is ready at ${config.appUrl}/${tenant.slug}.\n\nYour free trial runs for ${config.trialDays} days.`,
      action: { label: 'Open Lockred', url: `${config.appUrl}/${tenant.slug}` },
    });
    return { next: `/${tenant.slug}` };
  }

  // ---------- password reset ----------
  async forgot(email: string) {
    const account = await this.prisma.sys.account.findUnique({ where: { email: email.toLowerCase() } });
    if (!account || account.isDemo) return;
    await this.sendReset(account.id, account.email, 'Reset your Lockred password', 'Someone (hopefully you) asked to reset your password. The link works for 1 hour.');
  }

  /** Also used to let new operators/affiliates set their first password. */
  async sendReset(accountId: string, email: string, subject: string, text: string, hours = 1) {
    const token = newToken();
    await this.prisma.sys.passwordReset.create({
      data: { accountId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3_600_000) },
    });
    await this.mail.send({ to: email, subject, text, action: { label: 'Choose a password', url: `${config.appUrl}/reset/${token}` } });
  }

  async reset(token: string, password: string) {
    this.checkPasswordStrength(password);
    const r = await this.prisma.sys.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!r || r.usedAt || r.expiresAt < new Date()) throw badRequest('This link has expired. Ask for a new one.');
    const passwordHash = await this.hash(password);
    await this.prisma.sys.$transaction([
      this.prisma.sys.account.update({ where: { id: r.accountId }, data: { passwordHash } }),
      this.prisma.sys.passwordReset.update({ where: { id: r.id }, data: { usedAt: new Date() } }),
      this.prisma.sys.session.deleteMany({ where: { accountId: r.accountId } }),
    ]);
    return { ok: true };
  }

  async changePassword(ctx: Ctx, current: string, next: string) {
    this.checkPasswordStrength(next);
    const account = await this.prisma.sys.account.findUniqueOrThrow({ where: { id: ctx.accountId } });
    if (!(await this.verify(account.passwordHash, current))) throw badRequest('Your current password is wrong');
    await this.prisma.sys.account.update({ where: { id: account.id }, data: { passwordHash: await this.hash(next) } });
    await this.prisma.sys.session.deleteMany({ where: { accountId: account.id, NOT: { id: ctx.sessionId } } });
    return { ok: true };
  }

  async updateProfile(ctx: Ctx, name: string) {
    if (ctx.account.isDemo) throw forbidden('Not available in the demo');
    await this.prisma.sys.account.update({ where: { id: ctx.accountId }, data: { name: name.trim() } });
    return { ok: true };
  }

  // ---------- invites ----------
  async inviteInfo(token: string) {
    const invite = await this.prisma.sys.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { tenant: true } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw notFound('This invitation has expired or was already used');
    const existing = await this.prisma.sys.account.findUnique({ where: { email: invite.email } });
    return { email: invite.email, tenantName: invite.tenant.name, role: invite.role, hasAccount: !!existing };
  }

  async acceptInvite(res: Response, token: string, input: { name?: string; password: string }, ip?: string, ua?: string) {
    const invite = await this.prisma.sys.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { tenant: true } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw notFound('This invitation has expired or was already used');
    let account = await this.prisma.sys.account.findUnique({ where: { email: invite.email } });
    if (account) {
      if (!(await this.verify(account.passwordHash, input.password))) throw new HttpException(INVALID_LOGIN, HttpStatus.UNAUTHORIZED);
    } else {
      this.checkPasswordStrength(input.password);
      if (!input.name?.trim()) throw badRequest('Tell us your name');
      account = await this.prisma.sys.account.create({
        data: { email: invite.email, name: input.name.trim(), passwordHash: await this.hash(input.password) },
      });
    }
    const acc = account;
    await this.prisma.sys.$transaction(async (tx) => {
      await tx.membership.upsert({
        where: { tenantId_accountId: { tenantId: invite.tenantId, accountId: acc.id } },
        create: { tenantId: invite.tenantId, accountId: acc.id, role: invite.role as TenantRole, invitedById: invite.invitedById },
        update: { status: 'ACTIVE', role: invite.role as TenantRole },
      });
      await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
      await tx.auditLog.create({
        data: { tenantId: invite.tenantId, actorAccountId: acc.id, actorName: acc.name, action: 'member.joined', data: { role: invite.role } },
      });
    });
    if (acc.totpEnabled) {
      await this.startSession(res, acc, { tenantId: invite.tenantId, mfaPending: true, ip, userAgent: ua });
      return { mfaRequired: true };
    }
    await this.startSession(res, acc, { tenantId: invite.tenantId, ip, userAgent: ua });
    return { mfaRequired: false, next: `/${invite.tenant.slug}` };
  }
}
