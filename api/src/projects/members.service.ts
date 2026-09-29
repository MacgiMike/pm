import { Injectable } from '@nestjs/common';
import { ProjectRole } from '@prisma/client';
import { config } from '../config';
import { AuditService } from '../core/audit.service';
import { Ctx } from '../core/context';
import { MailService } from '../core/mail.service';
import { PrismaService, Tx } from '../core/prisma.service';
import { newGuidToken, sha256 } from '../core/tokens';
import { badRequest, notFound } from '../core/util';
import { AccessService } from './access.service';
import { addActivity } from './activity';

@Injectable()
export class MembersService {
  constructor(
    private prisma: PrismaService,
    private access: AccessService,
    private audit: AuditService,
    private mail: MailService,
  ) {}

  private t<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.tenant(ctx.tenantId!, fn);
  }

  async list(ctx: Ctx, projectId: string) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      const members = await tx.projectMember.findMany({
        where: { projectId },
        include: { account: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const names = new Map(members.map((m) => [m.accountId, m.account.name]));
      let candidates: { accountId: string; name: string; email: string; tenantRole: string }[] = [];
      if (a.can.members) {
        const tenantMembers = await tx.membership.findMany({
          where: { status: 'ACTIVE', accountId: { notIn: members.map((m) => m.accountId) } },
          include: { account: { select: { id: true, name: true, email: true, isDemo: true } } },
        });
        candidates = tenantMembers
          .map((m) => ({ accountId: m.accountId, name: m.account.name, email: m.account.email, tenantRole: m.role }))
          .sort((x, y) => x.name.localeCompare(y.name));
      }
      const links = await tx.taskLink.findMany({
        where: { projectId, revokedAt: null },
        include: { task: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
      });
      const roleOrder: Record<ProjectRole, number> = { OWNER: 0, COLEAD: 1, CONTRIBUTOR: 2 };
      return {
        role: a.role,
        can: a.can,
        members: members
          .sort((x, y) => roleOrder[x.role] - roleOrder[y.role] || x.account.name.localeCompare(y.account.name))
          .map((m) => ({
            id: m.id,
            accountId: m.accountId,
            name: m.account.name,
            email: m.account.email,
            role: m.role,
            addedAt: m.createdAt,
            addedByName: m.addedById ? names.get(m.addedById) ?? null : null,
          })),
        candidates,
        links: links.map((l) => ({
          id: l.id,
          guestName: l.guestName,
          guestEmail: a.can.links ? l.guestEmail : undefined,
          guestOrg: l.guestOrg,
          task: { id: l.task.id, title: l.task.title },
          expiresAt: l.expiresAt,
          lastUsedAt: l.lastUsedAt,
          active: l.expiresAt > new Date(),
        })),
      };
    });
  }

  async add(ctx: Ctx, projectId: string, input: { accountId: string; role: 'COLEAD' | 'CONTRIBUTOR' }) {
    const res = await this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      this.access.require(a, 'members');
      const m = await tx.membership.findUnique({
        where: { tenantId_accountId: { tenantId: ctx.tenantId!, accountId: input.accountId } },
        include: { account: true },
      });
      if (!m || m.status !== 'ACTIVE') throw badRequest('That person is not an active member of the organization');
      const existing = await tx.projectMember.findUnique({
        where: { projectId_accountId: { projectId, accountId: input.accountId } },
      });
      if (existing) throw badRequest(`${m.account.name} is already on the team`);
      await tx.projectMember.create({
        data: { tenantId: ctx.tenantId!, projectId, accountId: input.accountId, role: input.role, addedById: ctx.accountId },
      });
      await addActivity(tx, ctx, projectId, {
        kind: 'member.added',
        text: `added ${m.account.name} as ${input.role === 'COLEAD' ? 'co-lead' : 'contributor'}`,
      });
      await this.audit.log(tx, ctx, 'project.member_added', { type: 'project', id: projectId }, { accountId: input.accountId, role: input.role });
      return { account: m.account, project: a.project };
    });
    if (!ctx.tenant!.isDemo) {
      await this.mail.send({
        to: res.account.email,
        subject: `You’ve been added to ${res.project.name}`,
        text: `${ctx.account.name} added you to ${res.project.name} as ${input.role === 'COLEAD' ? 'co-lead' : 'contributor'}.`,
        action: { label: 'Open the project', url: `${config.appUrl}/${ctx.tenant!.slug}/p/${projectId}` },
      });
    }
    return { ok: true };
  }

  async setRole(ctx: Ctx, projectId: string, memberId: string, role: 'COLEAD' | 'CONTRIBUTOR') {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'members');
      const m = await tx.projectMember.findFirst({ where: { id: memberId, projectId }, include: { account: true } });
      if (!m) throw notFound();
      if (m.role === 'OWNER') throw badRequest('The owner is changed by an admin or portfolio manager');
      await tx.projectMember.update({ where: { id: memberId }, data: { role } });
      await addActivity(tx, ctx, projectId, {
        kind: 'member.role',
        text: `made ${m.account.name} ${role === 'COLEAD' ? 'co-lead' : 'contributor'}`,
      });
      await this.audit.log(tx, ctx, 'project.member_role', { type: 'project', id: projectId }, { accountId: m.accountId, role });
      return { ok: true };
    });
  }

  async remove(ctx: Ctx, projectId: string, memberId: string) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'members');
      const m = await tx.projectMember.findFirst({ where: { id: memberId, projectId }, include: { account: true } });
      if (!m) throw notFound();
      if (m.role === 'OWNER') throw badRequest('The owner can’t be removed. Ask a manager to change the owner first.');
      await tx.projectMember.delete({ where: { id: memberId } });
      await tx.task.updateMany({ where: { projectId, assigneeAccountId: m.accountId }, data: { assigneeAccountId: null } });
      await addActivity(tx, ctx, projectId, { kind: 'member.removed', text: `removed ${m.account.name} from the team` });
      await this.audit.log(tx, ctx, 'project.member_removed', { type: 'project', id: projectId }, { accountId: m.accountId });
      return { ok: true };
    });
  }

  // ---------- Task links (external guests, no login) ----------
  async createLink(
    ctx: Ctx,
    projectId: string,
    taskId: string,
    input: { guestName: string; guestEmail: string; guestOrg?: string; canComment: boolean; canFiles: boolean; untilDone: boolean; days: number },
  ) {
    const token = newGuidToken();
    const res = await this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      this.access.require(a, 'links');
      const task = await tx.task.findFirst({ where: { id: taskId, projectId } });
      if (!task) throw notFound('Task not found');
      const days = Math.max(1, Math.min(input.days, ctx.tenant!.settings.taskLinkMaxDays));
      const link = await tx.taskLink.create({
        data: {
          tenantId: ctx.tenantId!,
          projectId,
          taskId,
          tokenHash: sha256(token),
          guestName: input.guestName.trim(),
          guestEmail: input.guestEmail.toLowerCase(),
          guestOrg: input.guestOrg?.trim() ?? '',
          canComment: input.canComment,
          canFiles: input.canFiles,
          untilDone: input.untilDone,
          expiresAt: new Date(Date.now() + days * 86_400_000),
          createdById: ctx.accountId,
        },
      });
      await addActivity(tx, ctx, projectId, { kind: 'link.created', text: `shared the task with ${link.guestName}`, taskId });
      await this.audit.log(tx, ctx, 'task_link.created', { type: 'task', id: taskId }, { guest: link.guestEmail, days });
      return { link, task, project: a.project };
    });
    const url = `${config.appUrl}/t/${token}`;
    if (!ctx.tenant!.isDemo) await this.sendLink(ctx, res.link.guestEmail, res.link.guestName, res.task.title, res.project.name, url);
    return { id: res.link.id, url };
  }

  async resendLink(ctx: Ctx, projectId: string, linkId: string) {
    const token = newGuidToken();
    const res = await this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'links');
      const link = await tx.taskLink.findFirst({ where: { id: linkId, projectId, revokedAt: null }, include: { task: true, project: true } });
      if (!link) throw notFound('Link not found');
      // A fresh token each time: the old link stops working.
      await tx.taskLink.update({ where: { id: linkId }, data: { tokenHash: sha256(token) } });
      await this.audit.log(tx, ctx, 'task_link.resent', { type: 'task', id: link.taskId });
      return link;
    });
    const url = `${config.appUrl}/t/${token}`;
    if (!ctx.tenant!.isDemo) await this.sendLink(ctx, res.guestEmail, res.guestName, res.task.title, res.project.name, url);
    return { url };
  }

  async revokeLink(ctx: Ctx, projectId: string, linkId: string) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'links');
      const link = await tx.taskLink.findFirst({ where: { id: linkId, projectId } });
      if (!link) throw notFound('Link not found');
      await tx.taskLink.update({ where: { id: linkId }, data: { revokedAt: new Date() } });
      await addActivity(tx, ctx, projectId, { kind: 'link.revoked', text: `stopped sharing with ${link.guestName}`, taskId: link.taskId });
      await this.audit.log(tx, ctx, 'task_link.revoked', { type: 'task', id: link.taskId });
      return { ok: true };
    });
  }

  private sendLink(ctx: Ctx, to: string, guest: string, task: string, project: string, url: string) {
    return this.mail.send({
      to,
      subject: `${ctx.account.name} shared a task with you: ${task}`,
      text: `Hi ${guest.split(' ')[0]},\n\n${ctx.account.name} at ${ctx.tenant!.name} shared the task “${task}” (${project}) with you.\n\nOpen the link to see what’s needed and update your progress. You don’t need an account. Please don’t forward the link — it only works for you.`,
      action: { label: 'Open the task', url },
    });
  }
}
