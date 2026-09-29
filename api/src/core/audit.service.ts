import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Ctx } from './context';
import { Tx } from './prisma.service';

@Injectable()
export class AuditService {
  async log(
    tx: Tx,
    ctx: Pick<Ctx, 'accountId' | 'account' | 'tenantId'>,
    action: string,
    target?: { type: string; id: string },
    data: Record<string, unknown> = {},
  ) {
    if (!ctx.tenantId) return;
    await tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorAccountId: ctx.accountId,
        actorName: ctx.account.name,
        action,
        targetType: target?.type ?? '',
        targetId: target?.id ?? '',
        data: data as Prisma.InputJsonValue,
      },
    });
  }
}
