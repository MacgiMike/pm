import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config';

export type Tx = Prisma.TransactionClient;

/**
 * Two database connections:
 *  - `sys` uses the owner role and bypasses row-level security. Only used for
 *    global tables (accounts, sessions, affiliates, Stripe) and operator/system jobs.
 *  - `app` uses the restricted `lockred_app` role. All tenant data goes through
 *    `tenant()`, which pins the transaction to one tenant; Postgres then refuses
 *    to show or write rows of any other tenant.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly sys = new PrismaClient({ datasourceUrl: config.databaseUrl });
  readonly app = new PrismaClient({ datasourceUrl: config.appDatabaseUrl });

  async tenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!tenantId) throw new Error('tenant() called without a tenant id');
    return this.app.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return fn(tx);
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  async onModuleDestroy() {
    await Promise.all([this.sys.$disconnect(), this.app.$disconnect()]);
  }
}
