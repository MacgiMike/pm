import { Body, Controller, Get, HttpCode, Injectable, Param, Post, UseGuards } from '@nestjs/common';
import { Prisma, TicketType } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config';
import { Ctx } from '../core/context';
import { AllowInactiveTenant, CurrentCtx, TenantGuard } from '../core/guards';
import { MailService } from '../core/mail.service';
import { PrismaService } from '../core/prisma.service';
import { forbidden, notFound, parse } from '../core/util';

export const ticketRef = (n: number) => `LR-${String(n).padStart(4, '0')}`;

@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService, private mail: MailService) {}

  async list(ctx: Ctx) {
    return this.prisma.tenant(ctx.tenantId!, async (tx) => {
      const seeAll = ctx.tenantRole === 'ADMIN';
      const rows = await tx.ticket.findMany({
        where: seeAll ? {} : { createdById: ctx.accountId },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        include: { _count: { select: { messages: true } } },
      });
      return rows.map((t) => ({
        id: t.id,
        ref: ticketRef(t.number),
        type: t.type,
        severity: t.severity,
        subject: t.subject,
        status: t.status,
        createdByName: t.createdByName,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        messages: t._count.messages,
      }));
    });
  }

  async create(
    ctx: Ctx,
    input: { type: TicketType; severity?: string; subject: string; body: string; diagnostics?: Record<string, unknown> },
  ) {
    if (ctx.tenant!.isDemo) throw forbidden('This is a demo. Start a free trial or email us to get in touch.');
    const t = await this.prisma.tenant(ctx.tenantId!, (tx) =>
      tx.ticket.create({
        data: {
          tenantId: ctx.tenantId!,
          type: input.type,
          severity: input.severity ?? '',
          subject: input.subject,
          body: input.body,
          createdById: ctx.accountId,
          createdByName: ctx.account.name,
          diagnostics: input.diagnostics ? (input.diagnostics as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      }),
    );
    const ref = ticketRef(t.number);
    if (config.opsNotifyEmail) {
      await this.mail.send({
        to: config.opsNotifyEmail,
        subject: `[${ref}] ${input.type}${input.severity ? ` (${input.severity})` : ''}: ${input.subject}`,
        text: `From ${ctx.account.name} <${ctx.account.email}> at ${ctx.tenant!.name} (${ctx.tenant!.slug})\n\n${input.body}`,
        action: { label: 'Open in operator console', url: `${config.appUrl}/ops/support/${t.id}` },
      });
    }
    await this.mail.send({
      to: ctx.account.email,
      subject: `We got your request ${ref}: ${input.subject}`,
      text: `Thanks — we’ll get back to you, usually within one working day. You can follow the request under Help & support.`,
      action: { label: 'View your request', url: `${config.appUrl}/${ctx.tenant!.slug}/support/${t.id}` },
    });
    return { id: t.id, ref };
  }

  async get(ctx: Ctx, id: string) {
    return this.prisma.tenant(ctx.tenantId!, async (tx) => {
      const t = await tx.ticket.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
      if (!t || (ctx.tenantRole !== 'ADMIN' && t.createdById !== ctx.accountId)) throw notFound('Request not found');
      return {
        id: t.id,
        ref: ticketRef(t.number),
        type: t.type,
        severity: t.severity,
        subject: t.subject,
        body: t.body,
        status: t.status,
        createdByName: t.createdByName,
        createdAt: t.createdAt,
        messages: t.messages.map((m) => ({ id: m.id, authorName: m.authorName, fromOperator: m.fromOperator, body: m.body, createdAt: m.createdAt })),
      };
    });
  }

  async reply(ctx: Ctx, id: string, body: string) {
    const t = await this.prisma.tenant(ctx.tenantId!, async (tx) => {
      const t = await tx.ticket.findUnique({ where: { id } });
      if (!t || (ctx.tenantRole !== 'ADMIN' && t.createdById !== ctx.accountId)) throw notFound('Request not found');
      await tx.ticketMessage.create({ data: { tenantId: ctx.tenantId!, ticketId: id, authorName: ctx.account.name, body } });
      await tx.ticket.update({
        where: { id },
        data: { status: t.status === 'WAITING_ON_CUSTOMER' || t.status === 'RESOLVED' ? 'OPEN' : t.status },
      });
      return t;
    });
    if (config.opsNotifyEmail) {
      await this.mail.send({
        to: config.opsNotifyEmail,
        subject: `[${ticketRef(t.number)}] New reply from ${ctx.account.name}`,
        text: body,
        action: { label: 'Open in operator console', url: `${config.appUrl}/ops/support/${t.id}` },
      });
    }
    return { ok: true };
  }

  // Ideas are shared across all tenants; votes are per person.
  async ideas(ctx: Ctx) {
    const ideas = await this.prisma.sys.idea.findMany({
      where: { status: { not: 'DECLINED' } },
      include: { _count: { select: { votes: true } }, votes: { where: { accountId: ctx.accountId }, select: { accountId: true } } },
    });
    return ideas
      .map((i) => ({ id: i.id, title: i.title, description: i.description, status: i.status, votes: i._count.votes, voted: i.votes.length > 0 }))
      .sort((a, b) => b.votes - a.votes);
  }

  async vote(ctx: Ctx, ideaId: string) {
    const idea = await this.prisma.sys.idea.findUnique({ where: { id: ideaId } });
    if (!idea) throw notFound();
    const existing = await this.prisma.sys.ideaVote.findUnique({ where: { ideaId_accountId: { ideaId, accountId: ctx.accountId } } });
    if (existing) await this.prisma.sys.ideaVote.delete({ where: { ideaId_accountId: { ideaId, accountId: ctx.accountId } } });
    else await this.prisma.sys.ideaVote.create({ data: { ideaId, accountId: ctx.accountId, tenantId: ctx.tenantId! } });
    return { voted: !existing };
  }
}

@Controller('support')
@UseGuards(TenantGuard)
@AllowInactiveTenant()
export class SupportController {
  constructor(private support: SupportService) {}

  @Get('tickets')
  list(@CurrentCtx() ctx: Ctx) {
    return this.support.list(ctx);
  }

  @Post('tickets')
  create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(
      z.object({
        type: z.enum(['PROBLEM', 'QUESTION', 'FEATURE', 'BILLING']),
        severity: z.enum(['', 'BLOCKING', 'SLOWS_DOWN', 'MINOR']).optional(),
        subject: z.string().trim().min(3).max(200),
        body: z.string().trim().min(3).max(20_000),
        diagnostics: z.record(z.unknown()).optional(),
      }),
      body,
    );
    return this.support.create(ctx, b);
  }

  @Get('tickets/:id')
  get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.support.get(ctx, id);
  }

  @Post('tickets/:id/messages')
  reply(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    return this.support.reply(ctx, id, parse(z.object({ body: z.string().trim().min(1).max(20_000) }), body).body);
  }

  @Get('ideas')
  ideas(@CurrentCtx() ctx: Ctx) {
    return this.support.ideas(ctx);
  }

  @Post('ideas/:id/vote')
  @HttpCode(200)
  vote(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.support.vote(ctx, id);
  }
}
