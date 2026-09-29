-- Lockred Projects: initial schema + row-level security.

-- ============ Enums ============
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "PlanTier" AS ENUM ('STARTER', 'TEAM', 'BUSINESS', 'DEMO');
CREATE TYPE "TenantRole" AS ENUM ('ADMIN', 'MANAGER', 'MEMBER');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'COLEAD', 'CONTRIBUTOR');
CREATE TYPE "ProjectStatus" AS ENUM ('SETUP', 'ACTIVE', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "KpiDirection" AS ENUM ('INCREASE', 'DECREASE');
CREATE TYPE "TicketType" AS ENUM ('PROBLEM', 'QUESTION', 'FEATURE', 'BILLING');
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'WAITING_ON_CUSTOMER', 'PLANNED', 'RESOLVED', 'CLOSED');
CREATE TYPE "IdeaStatus" AS ENUM ('UNDER_REVIEW', 'PLANNED', 'SHIPPED', 'DECLINED');
CREATE TYPE "AffiliateStatus" AS ENUM ('ACTIVE', 'PAUSED');
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'PAID', 'VOID');

-- ============ Tables ============
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isOperator" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "accountId" UUID NOT NULL,
    "tenantId" UUID,
    "mfaPending" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordReset" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "plan" "PlanTier" NOT NULL DEFAULT 'TEAM',
    "seats" INTEGER NOT NULL DEFAULT 10,
    "trialEndsAt" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'SEK',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Stockholm',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "demoAffiliateId" UUID,
    "referredByAffiliateId" UUID,
    "supportAccessUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Idea" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "IdeaStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdeaVote" (
    "ideaId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdeaVote_pkey" PRIMARY KEY ("ideaId","accountId")
);

CREATE TABLE "Affiliate" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "commissionPercent" INTEGER NOT NULL,
    "commissionMonths" INTEGER NOT NULL,
    "stripeAccountId" TEXT,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "AffiliateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReferralClick" (
    "id" UUID NOT NULL,
    "affiliateId" UUID NOT NULL,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralClick_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Commission" (
    "id" UUID NOT NULL,
    "affiliateId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "transferId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "role" "TenantRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invite" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "sponsor" TEXT NOT NULL DEFAULT '',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'SETUP',
    "approvedBudget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "inScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "setupStep" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectMember" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "addedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Directive" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Directive_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Kpi" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "baseline" DECIMAL(14,4),
    "target" DECIMAL(14,4) NOT NULL,
    "direction" "KpiDirection" NOT NULL DEFAULT 'INCREASE',
    "frequency" TEXT NOT NULL DEFAULT 'Monthly',
    "ownerName" TEXT NOT NULL DEFAULT '',
    "afterGoLive" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Kpi_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KpiValue" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kpiId" UUID NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "measuredAt" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KpiValue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tollgate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "passedAt" TIMESTAMP(3),
    "passedById" UUID,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tollgate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TollgateCriterion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "tollgateId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "met" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TollgateCriterion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Lane" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2F5BD3',
    "leadAccountId" UUID,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lane_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "laneId" UUID,
    "tollgateId" UUID,
    "budgetPostId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "assigneeAccountId" UUID,
    "startDate" DATE,
    "dueDate" DATE,
    "estimateHours" DECIMAL(8,1),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChecklistItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Activity" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "taskId" UUID,
    "actorAccountId" UUID,
    "actorName" TEXT NOT NULL,
    "viaTaskLinkId" UUID,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL DEFAULT '{}',
    "budgetOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BudgetPost" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BudgetPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BudgetPostLink" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "budgetPostId" UUID NOT NULL,
    "laneId" UUID,
    "taskId" UUID,
    CONSTRAINT "BudgetPostLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Cost" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "budgetPostId" UUID NOT NULL,
    "laneId" UUID,
    "taskId" UUID,
    "supplier" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "fileId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Cost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FileObject" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "taskId" UUID,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "budgetOnly" BOOLEAN NOT NULL DEFAULT false,
    "uploadedByAccountId" UUID,
    "uploadedByLinkId" UUID,
    "uploadedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskLink" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "guestOrg" TEXT NOT NULL DEFAULT '',
    "canComment" BOOLEAN NOT NULL DEFAULT true,
    "canFiles" BOOLEAN NOT NULL DEFAULT true,
    "untilDone" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectSnapshot" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "progress" DECIMAL(5,2) NOT NULL,
    "planned" DECIMAL(5,2) NOT NULL,
    "spent" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "ProjectSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorAccountId" UUID,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT '',
    "targetId" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Ticket" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "TicketType" NOT NULL,
    "severity" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" UUID,
    "createdByName" TEXT NOT NULL,
    "diagnostics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TicketMessage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "authorName" TEXT NOT NULL,
    "fromOperator" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- ============ Indexes ============
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_accountId_idx" ON "Session"("accountId");
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE UNIQUE INDEX "Tenant_stripeCustomerId_key" ON "Tenant"("stripeCustomerId");
CREATE UNIQUE INDEX "Tenant_stripeSubscriptionId_key" ON "Tenant"("stripeSubscriptionId");
CREATE UNIQUE INDEX "Tenant_demoAffiliateId_key" ON "Tenant"("demoAffiliateId");
CREATE UNIQUE INDEX "Affiliate_accountId_key" ON "Affiliate"("accountId");
CREATE UNIQUE INDEX "Affiliate_code_key" ON "Affiliate"("code");
CREATE UNIQUE INDEX "Affiliate_stripeAccountId_key" ON "Affiliate"("stripeAccountId");
CREATE INDEX "ReferralClick_affiliateId_createdAt_idx" ON "ReferralClick"("affiliateId", "createdAt");
CREATE UNIQUE INDEX "Commission_stripeInvoiceId_key" ON "Commission"("stripeInvoiceId");
CREATE UNIQUE INDEX "Membership_tenantId_accountId_key" ON "Membership"("tenantId", "accountId");
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");
CREATE UNIQUE INDEX "ProjectMember_projectId_accountId_key" ON "ProjectMember"("projectId", "accountId");
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX "Activity_projectId_createdAt_idx" ON "Activity"("projectId", "createdAt");
CREATE INDEX "Activity_taskId_createdAt_idx" ON "Activity"("taskId", "createdAt");
CREATE UNIQUE INDEX "Cost_fileId_key" ON "Cost"("fileId");
CREATE INDEX "Cost_projectId_date_idx" ON "Cost"("projectId", "date");
CREATE UNIQUE INDEX "TaskLink_tokenHash_key" ON "TaskLink"("tokenHash");
CREATE UNIQUE INDEX "ProjectSnapshot_projectId_date_key" ON "ProjectSnapshot"("projectId", "date");
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
CREATE UNIQUE INDEX "Ticket_number_key" ON "Ticket"("number");

-- ============ Foreign keys ============
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_referredByAffiliateId_fkey" FOREIGN KEY ("referredByAffiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_demoAffiliateId_fkey" FOREIGN KEY ("demoAffiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IdeaVote" ADD CONSTRAINT "IdeaVote_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralClick" ADD CONSTRAINT "ReferralClick_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Directive" ADD CONSTRAINT "Directive_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Directive" ADD CONSTRAINT "Directive_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Kpi" ADD CONSTRAINT "Kpi_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Kpi" ADD CONSTRAINT "Kpi_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KpiValue" ADD CONSTRAINT "KpiValue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KpiValue" ADD CONSTRAINT "KpiValue_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "Kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tollgate" ADD CONSTRAINT "Tollgate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tollgate" ADD CONSTRAINT "Tollgate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TollgateCriterion" ADD CONSTRAINT "TollgateCriterion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TollgateCriterion" ADD CONSTRAINT "TollgateCriterion_tollgateId_fkey" FOREIGN KEY ("tollgateId") REFERENCES "Tollgate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lane" ADD CONSTRAINT "Lane_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lane" ADD CONSTRAINT "Lane_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "Lane"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_tollgateId_fkey" FOREIGN KEY ("tollgateId") REFERENCES "Tollgate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_budgetPostId_fkey" FOREIGN KEY ("budgetPostId") REFERENCES "BudgetPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetPost" ADD CONSTRAINT "BudgetPost_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetPost" ADD CONSTRAINT "BudgetPost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetPostLink" ADD CONSTRAINT "BudgetPostLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetPostLink" ADD CONSTRAINT "BudgetPostLink_budgetPostId_fkey" FOREIGN KEY ("budgetPostId") REFERENCES "BudgetPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetPostLink" ADD CONSTRAINT "BudgetPostLink_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "Lane"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetPostLink" ADD CONSTRAINT "BudgetPostLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Cost" ADD CONSTRAINT "Cost_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Cost" ADD CONSTRAINT "Cost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Cost" ADD CONSTRAINT "Cost_budgetPostId_fkey" FOREIGN KEY ("budgetPostId") REFERENCES "BudgetPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cost" ADD CONSTRAINT "Cost_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "Lane"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cost" ADD CONSTRAINT "Cost_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cost" ADD CONSTRAINT "Cost_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskLink" ADD CONSTRAINT "TaskLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskLink" ADD CONSTRAINT "TaskLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskLink" ADD CONSTRAINT "TaskLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ Row-level security ============
-- The runtime role "lockred_app" is created by deploy/db-init (with a password).
-- Create it here too (without login) so the migration also runs on a bare database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lockred_app') THEN
    CREATE ROLE lockred_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO lockred_app;

-- Current tenant for this transaction. NULL (=> no rows) when not set.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

GRANT EXECUTE ON FUNCTION app_current_tenant() TO lockred_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Membership','Invite','Project','ProjectMember','Directive','Kpi','KpiValue',
    'Tollgate','TollgateCriterion','Lane','Task','ChecklistItem','Activity',
    'BudgetPost','BudgetPostLink','Cost','FileObject','TaskLink','ProjectSnapshot',
    'AuditLog','Ticket','TicketMessage'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO lockred_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO lockred_app', t);
  END LOOP;
END
$$;

-- A tenant can read and update only its own tenant row.
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON "Tenant" TO lockred_app
  USING ("id" = app_current_tenant()) WITH CHECK ("id" = app_current_tenant());
GRANT SELECT, UPDATE ON "Tenant" TO lockred_app;

-- Accounts are global; the app role may only read accounts that belong to the current tenant.
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_in_tenant ON "Account" FOR SELECT TO lockred_app
  USING (EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m."accountId" = "Account"."id" AND m."tenantId" = app_current_tenant()
  ));
GRANT SELECT ON "Account" TO lockred_app;

-- Ticket numbers come from a sequence.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lockred_app;
