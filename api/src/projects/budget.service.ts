import { Injectable } from '@nestjs/common';
import { Ctx } from '../core/context';
import { PrismaService, Tx } from '../core/prisma.service';
import { safeFileName, StorageService } from '../core/storage.service';
import { badRequest, dateOnly, notFound, num, ymd } from '../core/util';
import { Access, AccessService } from './access.service';
import { addActivity } from './activity';
import { actualProgress, forecast } from './metrics';
import { toLite } from './projects.service';
import { UploadedFileLike } from './tasks.service';

export interface CostInput {
  budgetPostId?: string;
  laneId?: string | null;
  taskId?: string | null;
  supplier?: string;
  reference?: string;
  amount?: number;
  date?: string;
  note?: string;
}

@Injectable()
export class BudgetService {
  constructor(private prisma: PrismaService, private access: AccessService, private storage: StorageService) {}

  private t<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.tenant(ctx.tenantId!, fn);
  }

  async get(ctx: Ctx, projectId: string) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      this.access.require(a, 'budgetView');
      const [posts, costs, lanes, tasks] = await Promise.all([
        tx.budgetPost.findMany({
          where: { projectId },
          orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
          include: { links: { include: { lane: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } } } },
        }),
        tx.cost.findMany({
          where: { projectId },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          include: {
            budgetPost: { select: { id: true, name: true } },
            lane: { select: { id: true, name: true } },
            task: { select: { id: true, title: true } },
            file: { select: { id: true, name: true } },
          },
        }),
        tx.lane.findMany({ where: { projectId }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true } }),
        tx.task.findMany({
          where: { projectId },
          orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, title: true, laneId: true, progress: true, estimateHours: true, startDate: true, dueDate: true },
        }),
      ]);
      const spentByPost = new Map<string, number>();
      for (const c of costs) spentByPost.set(c.budgetPostId, (spentByPost.get(c.budgetPostId) ?? 0) + num(c.amount));
      const lite = tasks.map(toLite);
      const progress = actualProgress(lite);
      const allocated = posts.reduce((s, p) => s + num(p.amount), 0);
      const approved = num(a.project.approvedBudget);
      const total = approved > 0 ? approved : allocated;
      const spent = costs.reduce((s, c) => s + num(c.amount), 0);

      /** Progress of the work a post pays for: its linked lanes and tasks, or the whole project. */
      const workProgress = (links: { laneId: string | null; taskId: string | null }[]) => {
        if (!links.length) return progress;
        const ids = new Set<string>();
        for (const l of links) {
          if (l.taskId) ids.add(l.taskId);
          if (l.laneId) lite.filter((t) => t.laneId === l.laneId).forEach((t) => ids.add(t.id!));
        }
        return actualProgress(lite.filter((t) => ids.has(t.id!)));
      };

      return {
        role: a.role,
        can: a.can,
        currency: ctx.tenant!.currency,
        totals: {
          approved,
          allocated,
          unallocated: approved > 0 ? approved - allocated : 0,
          total,
          spent,
          left: total - spent,
          progress,
          forecast: forecast(spent, total, progress),
        },
        posts: posts.map((p) => {
          const pSpent = spentByPost.get(p.id) ?? 0;
          const amount = num(p.amount);
          return {
            id: p.id,
            name: p.name,
            amount,
            sort: p.sort,
            spent: pSpent,
            left: amount - pSpent,
            pct: amount > 0 ? Math.round((pSpent / amount) * 100) : pSpent > 0 ? 100 : 0,
            workProgress: workProgress(p.links),
            links: p.links.map((l) =>
              l.lane
                ? { type: 'lane' as const, id: l.lane.id, name: l.lane.name }
                : { type: 'task' as const, id: l.task!.id, name: l.task!.title },
            ),
          };
        }),
        costs: costs.map((c) => ({
          id: c.id,
          date: ymd(c.date),
          supplier: c.supplier,
          reference: c.reference,
          amount: num(c.amount),
          note: c.note,
          post: c.budgetPost,
          lane: c.lane,
          task: c.task ? { id: c.task.id, name: c.task.title } : null,
          file: c.file,
          createdAt: c.createdAt,
        })),
        lanes,
        tasks: tasks.map((t) => ({ id: t.id, title: t.title, laneId: t.laneId })),
      };
    });
  }

  // ---------- Posts ----------
  async addPost(ctx: Ctx, projectId: string, input: { name: string; amount: number }) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'budgetEdit');
      const count = await tx.budgetPost.count({ where: { projectId } });
      const p = await tx.budgetPost.create({
        data: { tenantId: ctx.tenantId!, projectId, name: input.name, amount: input.amount, sort: count },
      });
      await addActivity(tx, ctx, projectId, { kind: 'budget.post', text: `added budget post ${p.name}`, budgetOnly: true });
      return { id: p.id };
    });
  }

  async updatePost(ctx: Ctx, projectId: string, postId: string, input: { name?: string; amount?: number; sort?: number }) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'budgetEdit');
      const r = await tx.budgetPost.updateMany({ where: { id: postId, projectId }, data: input });
      if (!r.count) throw notFound();
      return { ok: true };
    });
  }

  async deletePost(ctx: Ctx, projectId: string, postId: string) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'budgetEdit');
      if (await tx.cost.count({ where: { budgetPostId: postId } })) {
        throw badRequest('Costs are booked on this post. Move or delete them first.');
      }
      await tx.budgetPost.deleteMany({ where: { id: postId, projectId } });
      return { ok: true };
    });
  }

  async setLinks(ctx: Ctx, projectId: string, postId: string, input: { laneIds: string[]; taskIds: string[] }) {
    return this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'budgetEdit');
      const post = await tx.budgetPost.findFirst({ where: { id: postId, projectId } });
      if (!post) throw notFound();
      const lanes = await tx.lane.count({ where: { projectId, id: { in: input.laneIds } } });
      const tasks = await tx.task.count({ where: { projectId, id: { in: input.taskIds } } });
      if (lanes !== new Set(input.laneIds).size || tasks !== new Set(input.taskIds).size) throw badRequest('Unknown lane or task');
      await tx.budgetPostLink.deleteMany({ where: { budgetPostId: postId } });
      await tx.budgetPostLink.createMany({
        data: [
          ...[...new Set(input.laneIds)].map((laneId) => ({ tenantId: ctx.tenantId!, budgetPostId: postId, laneId })),
          ...[...new Set(input.taskIds)].map((taskId) => ({ tenantId: ctx.tenantId!, budgetPostId: postId, taskId })),
        ],
      });
      return { ok: true };
    });
  }

  // ---------- Costs ----------
  private async checkCostRefs(tx: Tx, a: Access, input: CostInput) {
    const pid = a.project.id;
    if (input.budgetPostId && !(await tx.budgetPost.findFirst({ where: { id: input.budgetPostId, projectId: pid } }))) {
      throw badRequest('Unknown budget post');
    }
    if (input.laneId && !(await tx.lane.findFirst({ where: { id: input.laneId, projectId: pid } }))) throw badRequest('Unknown swim lane');
    if (input.taskId) {
      const task = await tx.task.findFirst({ where: { id: input.taskId, projectId: pid } });
      if (!task) throw badRequest('Unknown task');
      if (!input.laneId && task.laneId) input.laneId = task.laneId;
    }
  }

  async addCost(ctx: Ctx, projectId: string, input: Required<Pick<CostInput, 'budgetPostId' | 'supplier' | 'amount' | 'date'>> & CostInput, file?: UploadedFileLike) {
    let storedKey: string | null = null;
    try {
      return await this.t(ctx, async (tx) => {
        const a = await this.access.project(tx, ctx, projectId);
        this.access.require(a, 'budgetEdit');
        await this.checkCostRefs(tx, a, input);
        let fileId: string | null = null;
        if (file) {
          storedKey = await this.storage.save(ctx.tenantId!, file.buffer);
          const f = await tx.fileObject.create({
            data: {
              tenantId: ctx.tenantId!,
              projectId,
              taskId: null,
              name: safeFileName(file.originalname),
              mime: file.mimetype || 'application/octet-stream',
              size: file.size,
              storageKey: storedKey,
              budgetOnly: true,
              uploadedByAccountId: ctx.accountId,
              uploadedByName: ctx.account.name,
            },
          });
          fileId = f.id;
        }
        const c = await tx.cost.create({
          data: {
            tenantId: ctx.tenantId!,
            projectId,
            budgetPostId: input.budgetPostId,
            laneId: input.laneId ?? null,
            taskId: input.taskId ?? null,
            supplier: input.supplier.trim(),
            reference: input.reference?.trim() ?? '',
            amount: input.amount,
            date: dateOnly(input.date),
            note: input.note ?? '',
            fileId,
            createdById: ctx.accountId,
          },
          include: { budgetPost: true },
        });
        await addActivity(tx, ctx, projectId, {
          kind: 'cost.booked',
          text: `booked ${input.reference ? input.reference + ' · ' : ''}${input.amount.toLocaleString('sv-SE')} ${ctx.tenant!.currency} from ${input.supplier} on ${c.budgetPost.name}`,
          taskId: input.taskId ?? null,
          budgetOnly: true,
          data: { costId: c.id, amount: input.amount },
        });
        return { id: c.id };
      });
    } catch (e) {
      if (storedKey) await this.storage.remove(storedKey);
      throw e;
    }
  }

  async updateCost(ctx: Ctx, projectId: string, costId: string, input: CostInput) {
    return this.t(ctx, async (tx) => {
      const a = await this.access.project(tx, ctx, projectId);
      this.access.require(a, 'budgetEdit');
      await this.checkCostRefs(tx, a, input);
      const r = await tx.cost.updateMany({
        where: { id: costId, projectId },
        data: {
          budgetPostId: input.budgetPostId,
          laneId: input.laneId,
          taskId: input.taskId,
          supplier: input.supplier,
          reference: input.reference,
          amount: input.amount,
          date: input.date ? dateOnly(input.date) : undefined,
          note: input.note,
        },
      });
      if (!r.count) throw notFound();
      return { ok: true };
    });
  }

  async deleteCost(ctx: Ctx, projectId: string, costId: string) {
    const key = await this.t(ctx, async (tx) => {
      this.access.require(await this.access.project(tx, ctx, projectId), 'budgetEdit');
      const c = await tx.cost.findFirst({ where: { id: costId, projectId }, include: { file: true } });
      if (!c) throw notFound();
      await tx.cost.delete({ where: { id: costId } });
      if (c.file) await tx.fileObject.delete({ where: { id: c.file.id } });
      await addActivity(tx, ctx, projectId, {
        kind: 'cost.deleted',
        text: `removed a cost of ${num(c.amount).toLocaleString('sv-SE')} from ${c.supplier}`,
        budgetOnly: true,
      });
      return c.file?.storageKey ?? null;
    });
    if (key) await this.storage.remove(key);
    return { ok: true };
  }

  async costsCsv(ctx: Ctx, projectId: string): Promise<string> {
    const b = await this.get(ctx, projectId);
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      ['Date', 'Supplier', 'Reference', 'Budget post', 'Lane', 'Task', 'Amount', 'Currency', 'Note'],
      ...b.costs.map((c) => [c.date, c.supplier, c.reference, c.post.name, c.lane?.name ?? '', c.task?.name ?? '', c.amount, b.currency, c.note]),
    ];
    return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
  }
}
