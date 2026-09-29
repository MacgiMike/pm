import { Controller, Get, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth/auth.service';
import { config } from './config';
import { Public } from './core/guards';
import { PrismaService } from './core/prisma.service';

/** Creates the first operator from OPERATOR_EMAIL / OPERATOR_PASSWORD if none exists. */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly log = new Logger('Bootstrap');
  constructor(private prisma: PrismaService, private auth: AuthService) {}

  async onApplicationBootstrap() {
    if (config.appSecret === 'dev-secret-change-me' && process.env.NODE_ENV === 'production') {
      this.log.warn('APP_SECRET is not set. Set a long random value in .env.');
    }
    const operators = await this.prisma.sys.account.count({ where: { isOperator: true } });
    if (operators > 0 || !config.operatorEmail) return;
    const existing = await this.prisma.sys.account.findUnique({ where: { email: config.operatorEmail } });
    if (existing) {
      await this.prisma.sys.account.update({ where: { id: existing.id }, data: { isOperator: true } });
    } else {
      const passwordHash = config.operatorPassword ? await this.auth.hash(config.operatorPassword) : null;
      await this.prisma.sys.account.create({
        data: { email: config.operatorEmail, name: 'Lockred operator', passwordHash, isOperator: true },
      });
    }
    this.log.log(`Operator account ready for ${config.operatorEmail}. Sign in and set up 2-step sign-in.`);
  }
}

@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async health() {
    await this.prisma.sys.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
