import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController, AdminService, PeopleController } from './admin/admin';
import { AffiliatesController, AffiliatesService } from './affiliates/affiliates';
import { AuthModule } from './auth/auth.module';
import { BillingController, BillingService } from './billing/billing';
import { StripeService } from './billing/stripe.service';
import { BootstrapService, HealthController } from './bootstrap';
import { CoreModule } from './core/core.module';
import { ErrorFilter } from './core/error.filter';
import { SessionGuard } from './core/guards';
import { DemoController, DemoService } from './demo/demo';
import { GuestController, GuestService } from './guest/guest';
import { OpsController, OpsService } from './ops/ops';
import { ProjectsModule } from './projects/projects.module';
import { ReportsController, ReportsService } from './reports/reports';
import { SupportController, SupportService } from './support/support';

@Module({
  imports: [
    CoreModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    AuthModule,
    ProjectsModule,
  ],
  controllers: [
    HealthController,
    AdminController,
    PeopleController,
    ReportsController,
    SupportController,
    BillingController,
    GuestController,
    DemoController,
    AffiliatesController,
    OpsController,
  ],
  providers: [
    // Order matters: rate limit first, then sessions.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
    BootstrapService,
    AdminService,
    ReportsService,
    SupportService,
    StripeService,
    BillingService,
    GuestService,
    DemoService,
    AffiliatesService,
    OpsService,
  ],
})
export class AppModule {}
