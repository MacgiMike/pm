import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { TaskLink } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config';
import { Public } from '../core/guards';
import { MailService } from '../core/mail.service';
import { PrismaService } from '../core/prisma.service';
import { safeFileName, StorageService } from '../core/storage.service';
import { sha256 } from '../core/tokens';
import { badRequest, forbidden, notFound, parse, todayUtc, ymd } from '../core/util';
import { activityOut } from '../projects/activity';
import { isLate } from '../projects/metrics';
import { toLite } from '../projects/projects.service';

const GONE = 'This link no longer works. Ask the person who shared it for a new one.';

@Injectable()
export class GuestService {
  constructor(private prisma: PrismaService, private storage: StorageService, private mail: MailService) {}

  /** Token → link. Uses the owner connection only to find which tenant the link belongs to. */
  private async resolve(token: string): Promise<TaskLink> {
    if (!/^[A-Za-z0-9-]{20,100}$/.test(token)) throw notFound(GONE);
    const link = await this.prisma.sys.taskLink.findUnique({ where: { tokenHash: sha256(token) } });
    if (!link || link.revokedAt || link.expiresAt < new Date()) throw notFound(GONE);
    const tenant = await this.prisma.sys.tenant.findUnique({ where: { id: link.tenantId } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') throw notFound(GONE);
    return link;
  }

  async view(token: string) {
    const link = await this.resolve(token);
    return this.prisma.tenant(link.tenantId, async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: link.taskId },
        include: { checklist: { orderBy: { sort: 'asc' } }, project: true },
      });
      if (!task) throw notFound(GONE);
      const [tenant, owner, updates, files, sharedBy] = await Promise.all([
        tx.tenant.findUnique({ where: { id: link.tenantId } }),
        tx.projectMember.findFirst({ where: { projectId: task.projectId, role: 'OWNER' }, include: { account: { select: { name: true } } } }),
        tx.activity.findMany({ where: { viaTaskLinkId: link.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
        tx.fileObject.findMany({ where: { uploadedByLinkId: link.id }, orderBy: { createdAt: 'desc' } }),
        link.createdById ? tx.account.findUnique({ where: { id: link.createdById }, select: { name: true } }) : null,
      ]);
      await tx.taskLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } });
      return {
        guestName: link.guestName,
        tenantName: tenant?.name ?? '',
        projectName: task.project.name,
        sharedBy: sharedBy?.name ?? owner?.account.name ?? '',
        task: {
          title: task.title,
          description: task.description,
          progress: task.progress,
          dueDate: ymd(task.dueDate),
          late: isLate(toLite(task), todayUtc()),
          checklist: task.checklist.map((c) => ({ text: c.text, done: c.done })),
        },
        permissions: { comment: link.canComment, files: link.canFiles },
        expiresAt: link.expiresAt,
        untilDone: link.untilDone,
        updates: updates.map(activityOut),
        files: files.map((f) => ({ id: f.id, name: f.name, size: f.size, createdAt: f.createdAt })),
      };
    });
  }

  async update(token: string, input: { progress: number; note?: string }) {
    const link = await this.resolve(token);
    const result = await this.prisma.tenant(link.tenantId, async (tx) => {
      const task = await tx.task.findUnique({ where: { id: link.taskId }, include: { project: true } });
      if (!task) throw notFound(GONE);
      const progress = Math.round(input.progress);
      const note = input.note?.trim() ?? '';
      if (note && !link.canComment) throw forbidden('This link can’t add comments');
      await tx.task.update({ where: { id: task.id }, data: { progress } });
      await tx.activity.create({
        data: {
          tenantId: link.tenantId,
          projectId: task.projectId,
          taskId: task.id,
          actorName: link.guestName,
          viaTaskLinkId: link.id,
          kind: 'task.progress',
          text: progress === task.progress ? `confirmed progress at ${progress}%` : `moved progress ${task.progress}% → ${progress}%`,
          data: { from: task.progress, to: progress, note },
        },
      });
      if (note) {
        await tx.activity.create({
          data: {
            tenantId: link.tenantId,
            projectId: task.projectId,
            taskId: task.id,
            actorName: link.guestName,
            viaTaskLinkId: link.id,
            kind: 'comment',
            text: note,
          },
        });
      }
      await tx.taskLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } });
      const tenant = await tx.tenant.findUnique({ where: { id: link.tenantId } });
      const creator = link.createdById
        ? await tx.account.findUnique({ where: { id: link.createdById }, select: { email: true, name: true } })
        : null;
      return { task, from: task.progress, progress, note, tenant, creator };
    });
    if (result.creator && result.tenant && !result.tenant.isDemo) {
      await this.mail.send({
        to: result.creator.email,
        subject: `${link.guestName} updated “${result.task.title}” to ${result.progress}%`,
        text: `${link.guestName}${link.guestOrg ? ` (${link.guestOrg})` : ''} updated ${result.task.title} in ${result.task.project.name}: ${result.from}% → ${result.progress}%.${
          result.note ? `\n\n“${result.note}”` : ''
        }`,
        action: { label: 'Open the task', url: `${config.appUrl}/${result.tenant.slug}/p/${result.task.projectId}/tasks/${result.task.id}` },
      });
    }
    return { ok: true, progress: result.progress };
  }

  async upload(token: string, file: Express.Multer.File) {
    if (!file) throw badRequest('No file received');
    const link = await this.resolve(token);
    if (!link.canFiles) throw forbidden('This link can’t add files');
    const key = await this.storage.save(link.tenantId, file.buffer);
    try {
      return await this.prisma.tenant(link.tenantId, async (tx) => {
        const task = await tx.task.findUnique({ where: { id: link.taskId } });
        if (!task) throw notFound(GONE);
        const f = await tx.fileObject.create({
          data: {
            tenantId: link.tenantId,
            projectId: task.projectId,
            taskId: task.id,
            name: safeFileName(file.originalname),
            mime: file.mimetype || 'application/octet-stream',
            size: file.size,
            storageKey: key,
            uploadedByLinkId: link.id,
            uploadedByName: link.guestName,
          },
        });
        await tx.activity.create({
          data: {
            tenantId: link.tenantId,
            projectId: task.projectId,
            taskId: task.id,
            actorName: link.guestName,
            viaTaskLinkId: link.id,
            kind: 'file',
            text: `attached ${f.name}`,
          },
        });
        return { id: f.id, name: f.name };
      });
    } catch (e) {
      await this.storage.remove(key);
      throw e;
    }
  }
}

@Controller('public/links')
@Public()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class GuestController {
  constructor(private guest: GuestService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.guest.view(token);
  }

  @Post(':token/update')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  update(@Param('token') token: string, @Body() body: unknown) {
    const b = parse(z.object({ progress: z.coerce.number().min(0).max(100), note: z.string().max(5000).optional() }), body);
    return this.guest.update(token, b);
  }

  @Post(':token/files')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.uploadMaxBytes, files: 1 } }))
  upload(@Param('token') token: string, @UploadedFile() file: Express.Multer.File) {
    return this.guest.upload(token, file);
  }
}
