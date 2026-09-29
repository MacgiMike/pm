import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AffiliateGuard, OperatorGuard, TenantGuard } from './guards';
import { MailService } from './mail.service';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [PrismaService, MailService, StorageService, AuditService, TenantGuard, OperatorGuard, AffiliateGuard],
  exports: [PrismaService, MailService, StorageService, AuditService, TenantGuard, OperatorGuard, AffiliateGuard],
})
export class CoreModule {}
