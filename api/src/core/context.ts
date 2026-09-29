import { TenantRole } from '@prisma/client';

export interface Ctx {
  sessionId: string;
  accountId: string;
  account: {
    id: string;
    name: string;
    email: string;
    isOperator: boolean;
    totpEnabled: boolean;
    isDemo: boolean;
  };
  tenantId: string | null;
  /** Filled in by TenantGuard */
  tenantRole?: TenantRole;
  tenant?: {
    id: string;
    slug: string;
    name: string;
    isDemo: boolean;
    status: string;
    settings: TenantSettings;
    currency: string;
    timezone: string;
  };
  ip?: string;
}

export interface TenantSettings {
  riskThreshold: number;
  behindThreshold: number;
  require2faForAdmins: boolean;
  allowedDomains: string[];
  sessionHours: number;
  taskLinkMaxDays: number;
  taskLinkRoles: ('OWNER' | 'COLEAD')[];
  whoCanCreateProjects: 'EVERYONE' | 'MANAGERS';
  weeklyReport: boolean;
  demoGuestToken?: string;
}

export const DEFAULT_SETTINGS: TenantSettings = {
  riskThreshold: 5,
  behindThreshold: 10,
  require2faForAdmins: false,
  allowedDomains: [],
  sessionHours: 12,
  taskLinkMaxDays: 90,
  taskLinkRoles: ['OWNER', 'COLEAD'],
  whoCanCreateProjects: 'EVERYONE',
  weeklyReport: true,
};

export function readSettings(raw: unknown): TenantSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<TenantSettings>;
  return { ...DEFAULT_SETTINGS, ...s };
}
