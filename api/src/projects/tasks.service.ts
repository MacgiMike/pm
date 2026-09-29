import { Injectable } from '@nestjs/common';
import { Prisma, TaskLink } from '@prisma/client';
import { Ctx } from '../core/context';
import { PrismaService, Tx } from '../core/prisma.service';
import { safeFileName, StorageService } from '../core/storage.service';
import { badRequest, dateOnly, forbidden, notFound, num, numOrNull, todayUtc, ymd } from '../core/util';
import { Access, AccessService } from './access.service';
import { activityOut, addActivity } from './activity';
import { actualProgress, expectedAt, isLate, plannedProgress } from './metrics';
import { toLite } from './projects.service';

export interface TaskInput {
  title?: string;
  description?: string;
  laneId?: string | null;
  tollgateId?: string | null;
  budgetPostId?: string | null;
  assigneeAccountId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  estimateHours?: number | null;
  progress?: number;
  sort?: number;
}

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService, private access: AccessService, private storage: StorageService) {}

  private t<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.tenant(ctx.tenantId!, fn);
  }

  private async names(tx: Tx, projectId: string) {
    const members = await tx.projectMember.findMany({
      where: { projectId },
      include: { account: { select: { id: true, name: true } } },
    });
    return new Map(members.map((m) => [m.accountId, m.account.name]));
  }

  private initials(name: string | undefined | null) {
    if (!name) return '';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  }

  // ---------- Board (swim lanes) ----------
  async board(ctx: Ctx, projectId: string) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      const today = todayUtc();
      const [lanes, tasks, names, links] = await Promise.all([
        tx.lane.findMany({ where: { projectId }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
        tx.task.findMany({ where: { projectId }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
        this.names(tx, projectId),
        tx.taskLink.findMany({
          where: { projectId, revokedAt: null, expiresAt: { gt: new Date() } },
          select: { taskId: true, guestName: true, guestOrg: true },
        }),
      ]);
      const postLinks: { laneId: string | null; budgetPost: { name: string } }[] = a.can.budgetView
        ? await tx.budgetPostLink.findMany({
            where: { budgetPost: { projectId } },
            select: { laneId: true, budgetPost: { select: { name: true } } },
          })
        : [];
      const card = (t: (typeof tasks)[number]) => {
        const link = links.find((l) => l.taskId === t.id);
        const assignee = t.assigneeAccountId ? names.get(t.assigneeAccountId) ?? null : null;
        return {
          id: t.id,
          title: t.title,
          progress: t.progress,
          estimateHours: numOrNull(t.estimateHours),
          dueDate: ymd(t.dueDate),
          late: isLate(toLite(t), today),
          assignee: assignee ? { id: t.assigneeAccountId, name: assignee, initials: this.initials(assignee) } : null,
          guest: link ? { name: link.guestName, org: link.guestOrg, initials: this.initials(link.guestName) } : null,
        };
      };
      const laneOut = (id: string | null, name: string, color: string, leadId: string | null) => {
        const lt = tasks.filter((t) => t.laneId === id);
        const lite = lt.map(toLite);
        return {
          id,
          name,
          color,
          leadName: leadId ? names.get(leadId) ?? null : null,
          hours: lite.reduce((s, t) => s + (t.estimateHours ?? 0), 0),
          progress: actualProgress(lite),
          planned: plannedProgress(lite, today, a.project.startDate),
          budgetPosts: postLinks.filter((pl) => pl.laneId === id).map((pl) => pl.budgetPost.name),
          tasks: lt.map(card),
        };
      };
      const out = lanes.map((l) => laneOut(l.id, l.name, l.color, l.leadAccountId));
      if (tasks.some((t) => !t.laneId)) out.push(laneOut(null, 'No lane', '#9C9A93', null));
      const all = tasks.map(toLite);
      return { role: a.role, can: a.can, progress: actualProgress(all), lanes: out };
    });
  }

  // ---------- Plan (timeline) ----------
  async plan(ctx: Ctx, projectId: string) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      const today = todayUtc();
      const [lanes, tasks, gates, names] = await Promise.all([
        tx.lane.findMany({ where: { projectId }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
        tx.task.findMany({ where: { projectId }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
        tx.tollgate.findMany({ where: { projectId }, orderBy: [{ date: 'asc' }, { sort: 'asc' }] }),
        this.names(tx, projectId),
      ]);
      return {
        role: a.role,
        can: a.can,
        project: { id: a.project.id, name: a.project.name, startDate: ymd(a.project.startDate), endDate: ymd(a.project.endDate) },
        today: ymd(today),
        lanes: lanes.map((l) => ({ id: l.id, name: l.name, color: l.color })),
        tollgates: gates.map((g) => ({ id: g.id, code: g.code, name: g.name, date: ymd(g.date), passed: !!g.passedAt })),
        tasks: tasks.map((t) => {
          const lite = toLite(t);
          const expected = expectedAt(lite, today, a.project.startDate);
          const assignee = t.assigneeAccountId ? names.get(t.assigneeAccountId) ?? null : null;
          return {
            id: t.id,
            title: t.title,
            laneId: t.laneId,
            tollgateId: t.tollgateId,
            startDate: ymd(t.startDate),
            dueDate: ymd(t.dueDate),
            estimateHours: numOrNull(t.estimateHours),
            progress: t.progress,
            assignee: assignee ? { id: t.assigneeAccountId, name: assignee, initials: this.initials(assignee) } : null,
            behind: expected !== null && t.progress < 100 && expected - t.progress > 10,
            late: isLate(lite, today),
          };
        }),
      };
    });
  }

  // ---------- CRUD ----------
  private async validateRefs(tx: Tx, a: Access, input: TaskInput) {
    const pid = a.project.id;
    if (input.laneId) {
      if (!(await tx.lane.findFirst({ where: { id: input.laneId, projectId: pid } }))) throw badRequest('Unknown swim lane');
    }
    if (input.tollgateId) {
      if (!(await tx.tollgate.findFirst({ where: { id: input.tollgateId, projectId: pid } }))) throw badRequest('Unknown tollgate');
    }
    if (input.budgetPostId !== undefined) {
      this.access.require(a, 'budgetEdit');
      if (input.budgetPostId && !(await tx.budgetPost.findFirst({ where: { id: input.budgetPostId, projectId: pid } }))) {
        throw badRequest('Unknown budget post');
      }
    }
    if (input.assigneeAccountId) {
      const m = await tx.projectMember.findUnique({
        where: { projectId_accountId: { projectId: pid, accountId: input.assigneeAccountId } },
      });
      if (!m) throw badRequest('The assignee must be on the project team');
    }
  }

  private data(input: TaskInput): Prisma.TaskUncheckedUpdateInput {
    const d: Prisma.TaskUncheckedUpdateInput = {};
    if (input.title !== undefined) d.title = input.title.trim();
    if (input.description !== undefined) d.description = input.description;
    if (input.laneId !== undefined) d.laneId = input.laneId;
    if (input.tollgateId !== undefined) d.tollgateId = input.tollgateId;
    if (input.budgetPostId !== undefined) d.budgetPostId = input.budgetPostId;
    if (input.assigneeAccountId !== undefined) d.assigneeAccountId = input.assigneeAccountId;
    if (input.startDate !== undefined) d.startDate = input.startDate ? dateOnly(input.startDate) : null;
    if (input.dueDate !== undefined) d.dueDate = input.dueDate ? dateOnly(input.dueDate) : null;
    if (input.estimateHours !== undefined) d.estimateHours = input.estimateHours;
    if (input.progress !== undefined) d.progress = Math.round(input.progress);
    if (input.sort !== undefined) d.sort = input.sort;
    return d;
  }

  async create(ctx: Ctx, projectId: string, input: TaskInput & { title: string }) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      this.access.require(a, 'work');
      await this.validateRefs(tx, a, input);
      const count = await tx.task.count({ where: { projectId, laneId: input.laneId ?? null } });
      const d = this.data(input) as unknown as Prisma.TaskUncheckedCreateInput;
      if (d.startDate && d.dueDate && (d.dueDate as Date) < (d.startDate as Date)) throw badRequest('The due date is before the start date');
      const task = await tx.task.create({
        data: { ...d, title: input.title.trim(), tenantId: ctx.tenantId!, projectId, sort: count, createdById: ctx.accountId },
      });
      await addActivity(tx, ctx, projectId, { kind: 'task.created', text: `added ${task.title}`, taskId: task.id });
      if (a.project.status === 'SETUP') await tx.project.update({ where: { id: projectId }, data: { status: 'ACTIVE' } });
      return { id: task.id };
    });
  }

  async get(ctx: Ctx, projectId: string, taskId: string) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      const task = await tx.task.findFirst({
        where: { id: taskId, projectId },
        include: {
          lane: true,
          tollgate: true,
          budgetPost: true,
          checklist: { orderBy: { sort: 'asc' } },
          files: { where: a.can.budgetView ? {} : { budgetOnly: false }, orderBy: { createdAt: 'desc' } },
          activities: {
            where: a.can.budgetView ? {} : { budgetOnly: false },
            orderBy: { createdAt: 'desc' },
            take: 50,
          },
        },
      });
      if (!task) throw notFound('Task not found');
      const names = await this.names(tx, projectId);
      const links: TaskLink[] = await tx.taskLink.findMany({ where: { taskId, revokedAt: null }, orderBy: { createdAt: 'desc' } });
      const projectTasks = await tx.task.findMany({
        where: { projectId },
        select: { id: true, laneId: true, progress: true, estimateHours: true },
      });
      const laneTasks = task.laneId ? projectTasks.filter((t) => t.laneId === task.laneId) : [];
      const assignee = task.assigneeAccountId ? names.get(task.assigneeAccountId) ?? null : null;
      const now = new Date();
      return {
        role: a.role,
        can: a.can,
        id: task.id,
        title: task.title,
        description: task.description,
        progress: task.progress,
        startDate: ymd(task.startDate),
        dueDate: ymd(task.dueDate),
        estimateHours: numOrNull(task.estimateHours),
        late: isLate(toLite(task), todayUtc()),
        lane: task.lane ? { id: task.lane.id, name: task.lane.name, color: task.lane.color } : null,
        tollgate: task.tollgate ? { id: task.tollgate.id, code: task.tollgate.code, name: task.tollgate.name, date: ymd(task.tollgate.date) } : null,
        budgetPost: a.can.budgetView && task.budgetPost ? { id: task.budgetPost.id, name: task.budgetPost.name } : null,
        assignee: assignee ? { id: task.assigneeAccountId, name: assignee } : null,
        // For "what happens if": weights to recompute lane/project progress client-side
        rollup: {
          laneOther: laneTasks.filter((t) => t.id !== task.id).map((t) => ({ progress: t.progress, hours: numOrNull(t.estimateHours) })),
          projectOther: projectTasks.filter((t) => t.id !== task.id).map((t) => ({ progress: t.progress, hours: numOrNull(t.estimateHours) })),
        },
        checklist: task.checklist.map((c) => ({ id: c.id, text: c.text, done: c.done })),
        files: task.files.map((f) => ({ id: f.id, name: f.name, size: f.size, uploadedByName: f.uploadedByName, createdAt: f.createdAt })),
        activity: task.activities.map(activityOut),
        links: links.map((l) => ({
          id: l.id,
          guestName: l.guestName,
          guestEmail: a.can.links ? l.guestEmail : undefined,
          guestOrg: l.guestOrg,
          canComment: l.canComment,
          canFiles: l.canFiles,
          untilDone: l.untilDone,
          expiresAt: l.expiresAt,
          lastUsedAt: l.lastUsedAt,
          active: l.expiresAt > now,
        })),
      };
    });
  }

  async update(ctx: Ctx, projectId: string, taskId: string, input: TaskInput) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      this.access.require(a, 'work');
      const task = await tx.task.findFirst({ where: { id: taskId, projectId } });
      if (!task) throw notFound('Task not found');
      await this.validateRefs(tx, a, input);
      const d = this.data(input);
      const start = d.startDate !== undefined ? (d.startDate as Date | null) : task.startDate;
      const due = d.dueDate !== undefined ? (d.dueDate as Date | null) : task.dueDate;
      if (start && due && due < start) throw badRequest('The due date is before the start date');
      await tx.task.update({ where: { id: taskId }, data: d });
      if (input.progress !== undefined && Math.round(input.progress) !== task.progress) {
        await addActivity(tx, ctx, projectId, {
          kind: 'task.progress',
          text: `moved progress ${task.progress}% → ${Math.round(input.progress)}%`,
          taskId,
          data: { from: task.progress, to: Math.round(input.progress) },
        });
        if (Math.round(input.progress) === 100) {
          // Links set to "until the task is done" stop working once the team marks it done.
          await tx.taskLink.updateMany({ where: { taskId, untilDone: true, revokedAt: null }, data: { revokedAt: new Date() } });
        }
      }
      if (input.dueDate !== undefined && ymd(task.dueDate) !== (input.dueDate ?? null)) {
        await addActivity(tx, ctx, projectId, { kind: 'task.dates', text: `changed the due date to ${input.dueDate ?? 'none'}`, taskId });
      }
      if (input.assigneeAccountId !== undefined && input.assigneeAccountId !== task.assigneeAccountId) {
        await addActivity(tx, ctx, projectId, { kind: 'task.assigned', text: `changed who is responsible`, taskId });
      }
      return { ok: true };
    });
  }

  async remove(ctx: Ctx, projectId: string, taskId: string) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      const task = await tx.task.findFirst({ where: { id: taskId, projectId } });
      if (!task) throw notFound('Task not found');
      if (!a.can.plan && !(a.can.work && task.createdById === ctx.accountId)) {
        throw forbidden('Only the owner, a co-lead or the person who created it can delete this task');
      }
      const costs = await tx.cost.count({ where: { taskId } });
      if (costs) throw badRequest('Costs are booked on this task. Move them to another task or lane first.');
      await tx.task.delete({ where: { id: taskId } });
      await addActivity(tx, ctx, projectId, { kind: 'task.deleted', text: `deleted ${task.title}` });
      return { ok: true };
    });
  }

  async reorder(ctx: Ctx, projectId: string, items: { id: string; laneId: string | null; sort: number }[]) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      this.access.require(a, 'work');
      for (const it of items) {
        if (it.laneId && !(await tx.lane.findFirst({ where: { id: it.laneId, projectId } }))) throw badRequest('Unknown swim lane');
        await tx.task.updateMany({ where: { id: it.id, projectId }, data: { laneId: it.laneId, sort: it.sort } });
      }
      return { ok: true };
    });
  }

  // ---------- Checklist ----------
  async addChecklist(ctx: Ctx, projectId: string, taskId: string, text: string) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'work');
      const task = await tx.task.findFirst({ where: { id: taskId, projectId } });
      if (!task) throw notFound();
      const count = await tx.checklistItem.count({ where: { taskId } });
      const c = await tx.checklistItem.create({ data: { tenantId: ctx.tenantId!, taskId, text, sort: count } });
      return { id: c.id };
    });
  }

  async updateChecklist(ctx: Ctx, projectId: string, itemId: string, input: { text?: string; done?: boolean }) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'work');
      const r = await tx.checklistItem.updateMany({ where: { id: itemId, task: { projectId } }, data: input });
      if (!r.count) throw notFound();
      return { ok: true };
    });
  }

  async deleteChecklist(ctx: Ctx, projectId: string, itemId: string) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'work');
      await tx.checklistItem.deleteMany({ where: { id: itemId, task: { projectId } } });
      return { ok: true };
    });
  }

  // ---------- Comments & files ----------
  async comment(ctx: Ctx, projectId: string, taskId: string, text: string) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'work');
      const task = await tx.task.findFirst({ where: { id: taskId, projectId } });
      if (!task) throw notFound();
      await addActivity(tx, ctx, projectId, { kind: 'comment', text, taskId });
      return { ok: true };
    });
  }

  async upload(ctx: Ctx, projectId: string, taskId: string, file: UploadedFileLike) {
    if (!file) throw badRequest('No file received');
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'work');
      const task = await tx.task.findFirst({ where: { id: taskId, projectId } });
      if (!task) throw notFound();
      const key = await this.storage.save(ctx.tenantId!, file.buffer);
      const f = await tx.fileObject.create({
        data: {
          tenantId: ctx.tenantId!,
          projectId,
          taskId,
          name: safeFileName(file.originalname),
          mime: file.mimetype || 'application/octet-stream',
          size: file.size,
          storageKey: key,
          uploadedByAccountId: ctx.accountId,
          uploadedByName: ctx.account.name,
        },
      });
      await addActivity(tx, ctx, projectId, { kind: 'file', text: `attached ${f.name}`, taskId });
      return { id: f.id };
    });
  }

  async fileForDownload(ctx: Ctx, projectId: string, fileId: string) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      const f = await tx.fileObject.findFirst({ where: { id: fileId, projectId } });
      if (!f) throw notFound('File not found');
      if (f.budgetOnly) this.access.require(a, 'budgetView');
      return f;
    });
  }

  async deleteFile(ctx: Ctx, projectId: string, fileId: string) {
    const key = await this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      const f = await tx.fileObject.findFirst({ where: { id: fileId, projectId } });
      if (!f) throw notFound('File not found');
      if (f.budgetOnly) this.access.require(a, 'budgetEdit');
      else if (!a.can.plan && f.uploadedByAccountId !== ctx.accountId) throw forbidden('You can only delete files you added');
      await tx.fileObject.delete({ where: { id: fileId } });
      return f.storageKey;
    });
    await this.storage.remove(key);
    return { ok: true };
  }

  // ---------- My tasks ----------
  async myTasks(ctx: Ctx) {
    return this.t(ctx, async (tx) => {
      const tasks = await tx.task.findMany({
        where: { assigneeAccountId: ctx.accountId, project: { archivedAt: null, members: { some: { accountId: ctx.accountId } } } },
        include: { project: { select: { id: true, name: true } }, lane: { select: { name: true, color: true } } },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      });
      const today = todayUtc();
      return tasks.map((t) => ({
        id: t.id,
        title: t.title,
        progress: t.progress,
        dueDate: ymd(t.dueDate),
        late: isLate(toLite(t), today),
        project: t.project,
        lane: t.lane,
      }));
    });
  }
}

