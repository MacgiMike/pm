'use client';
import { createContext, useContext } from 'react';

export interface Me {
  account: { id: string; name: string; email: string; isOperator: boolean; totpEnabled: boolean; isDemo: boolean };
  tenants: { id: string; slug: string; name: string; role: string; isDemo: boolean }[];
  tenant: null | {
    id: string; slug: string; name: string; role: 'ADMIN' | 'MANAGER' | 'MEMBER'; isDemo: boolean; status: string; plan: string;
    trialEndsAt: string | null; currency: string; usable: boolean; whoCanCreateProjects: 'EVERYONE' | 'MANAGERS'; mfaSetupRequired: boolean;
  };
  affiliate: { code: string; name: string } | null;
  operatorMfaSetupRequired: boolean;
}

export interface Can {
  work: boolean; plan: boolean; budgetView: boolean; budgetEdit: boolean; members: boolean; links: boolean; changeOwner: boolean; archive: boolean;
}

export interface ProjectHeader {
  id: string;
  name: string;
  role: 'OWNER' | 'COLEAD' | 'CONTRIBUTOR' | 'VIEWER';
  can: Can;
  health: string;
  owner: { id: string; name: string } | null;
  archived: boolean;
}

export interface TenantCtxValue {
  me: Me;
  slug: string;
  base: string;
  reloadMe: () => Promise<void>;
  project: ProjectHeader | null;
  setProject: (p: ProjectHeader | null) => void;
}

export const TenantCtx = createContext<TenantCtxValue | null>(null);

export function useTenant(): TenantCtxValue {
  const v = useContext(TenantCtx);
  if (!v) throw new Error('useTenant outside tenant layout');
  return v;
}

export interface ProjectCtxValue {
  id: string;
  header: ProjectHeader;
  /** Full overview payload from GET /projects/:id */
  data: any;
  reload: () => Promise<void>;
  base: string;
}

export const ProjectCtx = createContext<ProjectCtxValue | null>(null);

export function useProject(): ProjectCtxValue {
  const v = useContext(ProjectCtx);
  if (!v) throw new Error('useProject outside project layout');
  return v;
}
