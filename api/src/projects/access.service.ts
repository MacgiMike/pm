import { Injectable } from '@nestjs/common';
import { Project } from '@prisma/client';
import { Ctx } from '../core/context';
import { Tx } from '../core/prisma.service';
import { forbidden, notFound } from '../core/util';

export type AccessRole = 'OWNER' | 'COLEAD' | 'CONTRIBUTOR' | 'VIEWER';

export interface Can {
  /** Tasks, progress, comments, checklist, files */
  work: boolean;
  /** Directives, KPIs, tollgates, lanes, project settings */
  plan: boolean;
  budgetView: boolean;
  budgetEdit: boolean;
  /** Give / remove access to the project */
  members: boolean;
  /** Create / revoke task links for external people */
  links: boolean;
  changeOwner: boolean;
  archive: boolean;
}

export interface Access {
  project: Project;
  role: AccessRole;
  can: Can;
}

export function permissions(role: AccessRole, ctx: Ctx): Can {
  const tenantRole = ctx.tenantRole;
  const linkRoles = ctx.tenant?.settings.taskLinkRoles ?? ['OWNER', 'COLEAD'];
  const lead = role === 'OWNER' || role === 'COLEAD';
  return {
    work: role !== 'VIEWER',
    plan: lead,
    budgetView: lead || role === 'VIEWER',
    budgetEdit: lead,
    members: role === 'OWNER',
    links: (role === 'OWNER' || role === 'COLEAD') && linkRoles.includes(role),
    changeOwner: tenantRole === 'ADMIN' || tenantRole === 'MANAGER',
    archive: role === 'OWNER' || tenantRole === 'ADMIN',
  };
}

/**
 * Deny by default: a project is only reachable by its members, plus tenant
 * admins and portfolio managers who get read-only access. Anyone else gets a
 * 404 so project existence is not revealed.
 */
@Injectable()
export class AccessService {
  async project(tx: Tx, ctx: Ctx, projectId: string): Promise<Access> {
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw notFound('Project not found');
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Project not found');
    const role = await this.roleFor(tx, ctx, projectId);
    if (!role) throw notFound('Project not found');
    return { project, role, can: permissions(role, ctx) };
  }

  async roleFor(tx: Tx, ctx: Ctx, projectId: string): Promise<AccessRole | null> {
    const m = await tx.projectMember.findUnique({
      where: { projectId_accountId: { projectId, accountId: ctx.accountId } },
    });
    if (m) return m.role;
    if (ctx.tenantRole === 'ADMIN' || ctx.tenantRole === 'MANAGER') return 'VIEWER';
    return null;
  }

  require(access: Access, what: keyof Can, message?: string) {
    if (!access.can[what]) {
      const defaults: Record<keyof Can, string> = {
        work: 'You can view this project but not change it',
        plan: 'Only the project owner and co-leads can change this',
        budgetView: 'Budget is visible to the project owner and co-leads',
        budgetEdit: 'Only the project owner and co-leads can change the budget',
        members: 'Only the project owner can give or remove access',
        links: 'You can’t share tasks outside the organization',
        changeOwner: 'Only admins and portfolio managers can change the owner',
        archive: 'Only the owner or an admin can archive the project',
      };
      throw forbidden(message ?? defaults[what]);
    }
  }
}
