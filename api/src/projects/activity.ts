import { Prisma } from '@prisma/client';
import { Ctx } from '../core/context';
import { Tx } from '../core/prisma.service';

export async function addActivity(
  tx: Tx,
  ctx: Pick<Ctx, 'accountId' | 'account' | 'tenantId'>,
  projectId: string,
  a: { kind: string; text?: string; data?: Record<string, unknown>; taskId?: string | null; budgetOnly?: boolean },
) {
  await tx.activity.create({
    data: {
      tenantId: ctx.tenantId!,
      projectId,
      taskId: a.taskId ?? null,
      actorAccountId: ctx.accountId,
      actorName: ctx.account.name,
      kind: a.kind,
      text: a.text ?? '',
      data: (a.data ?? {}) as Prisma.InputJsonValue,
      budgetOnly: !!a.budgetOnly,
    },
  });
}

export function activityOut(a: {
  id: string;
  taskId: string | null;
  actorAccountId: string | null;
  actorName: string;
  viaTaskLinkId: string | null;
  kind: string;
  text: string;
  data: Prisma.JsonValue;
  createdAt: Date;
}) {
  return {
    id: a.id,
    taskId: a.taskId,
    actorName: a.actorName,
    viaTaskLink: !!a.viaTaskLinkId,
    kind: a.kind,
    text: a.text,
    data: a.data,
    createdAt: a.createdAt,
  };
}
