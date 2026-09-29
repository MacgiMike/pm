import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { Ctx } from '../core/context';
import { CurrentCtx, TenantGuard } from '../core/guards';
import { StorageService } from '../core/storage.service';
import { parse, zDate, zId, zMoney, zName, zText } from '../core/util';
import { BudgetService } from './budget.service';
import { MembersService } from './members.service';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';

const upload = () => FileInterceptor('file', { limits: { fileSize: config.uploadMaxBytes, files: 1 } });

const zKpi = z.object({
  name: zName.optional(),
  unit: zText(40).optional(),
  baseline: z.coerce.number().nullable().optional(),
  target: z.coerce.number().optional(),
  direction: z.enum(['INCREASE', 'DECREASE']).optional(),
  frequency: zText(40).optional(),
  ownerName: zText(120).optional(),
  afterGoLive: z.boolean().optional(),
  sort: z.number().int().optional(),
});

const zTask = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: zText(10_000).optional(),
  laneId: zId.nullable().optional(),
  tollgateId: zId.nullable().optional(),
  budgetPostId: zId.nullable().optional(),
  assigneeAccountId: zId.nullable().optional(),
  startDate: zDate.nullable().optional(),
  dueDate: zDate.nullable().optional(),
  estimateHours: z.coerce.number().min(0).max(100_000).nullable().optional(),
  progress: z.coerce.number().min(0).max(100).optional(),
  sort: z.number().int().optional(),
});

const zCost = z.object({
  budgetPostId: zId,
  laneId: zId.nullable().optional().or(z.literal('').transform(() => null)),
  taskId: zId.nullable().optional().or(z.literal('').transform(() => null)),
  supplier: z.string().trim().min(1).max(200),
  reference: zText(100).optional(),
  amount: zMoney,
  date: zDate,
  note: zText(2000).optional(),
});

@Controller('projects')
@UseGuards(TenantGuard)
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Get()
  list(@CurrentCtx() ctx: Ctx, @Query('archived') archived?: string) {
    return this.projects.portfolio(ctx, { includeArchived: archived === '1' });
  }

  @Post()
  create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ name: zName, startDate: zDate, endDate: zDate, purpose: zText(2000).optional() }), body);
    return this.projects.create(ctx, b);
  }

  @Get(':id')
  get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.projects.overview(ctx, id);
  }

  @Patch(':id')
  update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(
      z.object({
        name: zName.optional(),
        purpose: zText(4000).optional(),
        sponsor: zText(200).optional(),
        startDate: zDate.optional(),
        endDate: zDate.optional(),
        inScope: z.array(zText(120)).max(50).optional(),
        outScope: z.array(zText(120)).max(50).optional(),
        status: z.enum(['SETUP', 'ACTIVE', 'COMPLETED']).optional(),
        approvedBudget: zMoney.optional(),
        setupStep: z.number().int().min(1).max(6).optional(),
      }),
      body,
    );
    return this.projects.update(ctx, id, b);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    return this.projects.archive(ctx, id, parse(z.object({ archived: z.boolean() }), body).archived);
  }

  @Post(':id/owner')
  @HttpCode(200)
  owner(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ accountId: zId, reason: zText(1000).default(''), keepAsColead: z.boolean().default(true) }), body);
    return this.projects.changeOwner(ctx, id, b);
  }

  @Get(':id/activity')
  activity(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('before') before?: string) {
    return this.projects.activity(ctx, id, before);
  }

  // Directives
  @Post(':id/directives')
  addDirective(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    return this.projects.addDirective(ctx, id, parse(z.object({ text: z.string().trim().min(1).max(1000), source: zText(200).optional() }), body));
  }
  @Patch(':id/directives/:did')
  updateDirective(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('did') did: string, @Body() body: unknown) {
    return this.projects.updateDirective(
      ctx,
      id,
      did,
      parse(z.object({ text: z.string().trim().min(1).max(1000).optional(), source: zText(200).optional(), sort: z.number().int().optional() }), body),
    );
  }
  @Delete(':id/directives/:did')
  deleteDirective(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('did') did: string) {
    return this.projects.deleteDirective(ctx, id, did);
  }

  // KPIs
  @Post(':id/kpis')
  addKpi(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(zKpi.extend({ name: zName, target: z.coerce.number() }), body);
    return this.projects.addKpi(ctx, id, b);
  }
  @Patch(':id/kpis/:kid')
  updateKpi(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('kid') kid: string, @Body() body: unknown) {
    return this.projects.updateKpi(ctx, id, kid, parse(zKpi, body));
  }
  @Delete(':id/kpis/:kid')
  deleteKpi(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('kid') kid: string) {
    return this.projects.deleteKpi(ctx, id, kid);
  }
  @Post(':id/kpis/:kid/values')
  addKpiValue(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('kid') kid: string, @Body() body: unknown) {
    return this.projects.addKpiValue(ctx, id, kid, parse(z.object({ value: z.coerce.number(), measuredAt: zDate, note: zText(500).optional() }), body));
  }
  @Delete(':id/kpis/:kid/values/:vid')
  deleteKpiValue(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('kid') kid: string, @Param('vid') vid: string) {
    return this.projects.deleteKpiValue(ctx, id, kid, vid);
  }

  // Tollgates
  @Post(':id/tollgates')
  addTollgate(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ name: zName, date: zDate, code: zText(12).optional(), criteria: z.array(z.string().trim().min(1).max(300)).max(30).optional() }), body);
    return this.projects.addTollgate(ctx, id, b);
  }
  @Post(':id/tollgates/template')
  @HttpCode(200)
  tollgateTemplate(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    return this.projects.applyTollgateTemplate(ctx, id, parse(z.object({ template: z.enum(['standard5', 'light3']) }), body).template);
  }
  @Patch(':id/tollgates/:gid')
  updateTollgate(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('gid') gid: string, @Body() body: unknown) {
    return this.projects.updateTollgate(ctx, id, gid, parse(z.object({ name: zName.optional(), date: zDate.optional(), code: zText(12).optional() }), body));
  }
  @Delete(':id/tollgates/:gid')
  deleteTollgate(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('gid') gid: string) {
    return this.projects.deleteTollgate(ctx, id, gid);
  }
  @Post(':id/tollgates/:gid/pass')
  @HttpCode(200)
  passTollgate(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('gid') gid: string, @Body() body: unknown) {
    return this.projects.passTollgate(ctx, id, gid, parse(z.object({ passed: z.boolean() }), body).passed);
  }
  @Post(':id/tollgates/:gid/criteria')
  addCriterion(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('gid') gid: string, @Body() body: unknown) {
    return this.projects.addCriterion(ctx, id, gid, parse(z.object({ text: z.string().trim().min(1).max(300) }), body).text);
  }
  @Patch(':id/criteria/:cid')
  updateCriterion(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('cid') cid: string, @Body() body: unknown) {
    return this.projects.updateCriterion(ctx, id, cid, parse(z.object({ text: z.string().trim().min(1).max(300).optional(), met: z.boolean().optional() }), body));
  }
  @Delete(':id/criteria/:cid')
  deleteCriterion(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('cid') cid: string) {
    return this.projects.deleteCriterion(ctx, id, cid);
  }

  // Lanes
  @Post(':id/lanes')
  addLane(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ name: zName, color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), leadAccountId: zId.nullable().optional() }), body);
    return this.projects.addLane(ctx, id, b);
  }
  @Post(':id/lanes/reorder')
  @HttpCode(200)
  reorderLanes(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    return this.projects.reorderLanes(ctx, id, parse(z.object({ ids: z.array(zId).max(200) }), body).ids);
  }
  @Patch(':id/lanes/:lid')
  updateLane(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('lid') lid: string, @Body() body: unknown) {
    const b = parse(
      z.object({
        name: zName.optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        leadAccountId: zId.nullable().optional(),
        sort: z.number().int().optional(),
      }),
      body,
    );
    return this.projects.updateLane(ctx, id, lid, b);
  }
  @Delete(':id/lanes/:lid')
  deleteLane(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('lid') lid: string) {
    return this.projects.deleteLane(ctx, id, lid);
  }
}

@Controller('projects/:id')
@UseGuards(TenantGuard)
export class TasksController {
  constructor(private tasks: TasksService, private storage: StorageService) {}

  @Get('board')
  board(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.tasks.board(ctx, id);
  }

  @Get('plan')
  plan(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.tasks.plan(ctx, id);
  }

  @Post('tasks')
  create(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(zTask.extend({ title: z.string().trim().min(1).max(300) }), body);
    return this.tasks.create(ctx, id, b);
  }

  @Post('tasks/reorder')
  @HttpCode(200)
  reorder(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ items: z.array(z.object({ id: zId, laneId: zId.nullable(), sort: z.number().int() })).max(1000) }), body);
    return this.tasks.reorder(ctx, id, b.items);
  }

  @Get('tasks/:tid')
  get(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('tid') tid: string) {
    return this.tasks.get(ctx, id, tid);
  }

  @Patch('tasks/:tid')
  update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('tid') tid: string, @Body() body: unknown) {
    return this.tasks.update(ctx, id, tid, parse(zTask, body));
  }

  @Delete('tasks/:tid')
  remove(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('tid') tid: string) {
    return this.tasks.remove(ctx, id, tid);
  }

  @Post('tasks/:tid/checklist')
  addChecklist(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('tid') tid: string, @Body() body: unknown) {
    return this.tasks.addChecklist(ctx, id, tid, parse(z.object({ text: z.string().trim().min(1).max(300) }), body).text);
  }

  @Patch('checklist/:cid')
  updateChecklist(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('cid') cid: string, @Body() body: unknown) {
    return this.tasks.updateChecklist(ctx, id, cid, parse(z.object({ text: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional() }), body));
  }

  @Delete('checklist/:cid')
  deleteChecklist(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('cid') cid: string) {
    return this.tasks.deleteChecklist(ctx, id, cid);
  }

  @Post('tasks/:tid/comments')
  comment(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('tid') tid: string, @Body() body: unknown) {
    return this.tasks.comment(ctx, id, tid, parse(z.object({ text: z.string().trim().min(1).max(5000) }), body).text);
  }

  @Post('tasks/:tid/files')
  @UseInterceptors(upload())
  uploadFile(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('tid') tid: string, @UploadedFile() file: Express.Multer.File) {
    return this.tasks.upload(ctx, id, tid, file);
  }

  @Get('files/:fid')
  async download(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('fid') fid: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.tasks.fileForDownload(ctx, id, fid);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(this.storage.stream(f.storageKey));
  }

  @Delete('files/:fid')
  deleteFile(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('fid') fid: string) {
    return this.tasks.deleteFile(ctx, id, fid);
  }
}

@Controller('projects/:id')
@UseGuards(TenantGuard)
export class BudgetController {
  constructor(private budget: BudgetService) {}

  @Get('budget')
  get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.budget.get(ctx, id);
  }

  @Post('budget/posts')
  addPost(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    return this.budget.addPost(ctx, id, parse(z.object({ name: zName, amount: zMoney }), body));
  }

  @Patch('budget/posts/:pid')
  updatePost(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    return this.budget.updatePost(ctx, id, pid, parse(z.object({ name: zName.optional(), amount: zMoney.optional(), sort: z.number().int().optional() }), body));
  }

  @Delete('budget/posts/:pid')
  deletePost(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('pid') pid: string) {
    return this.budget.deletePost(ctx, id, pid);
  }

  @Put('budget/posts/:pid/links')
  setLinks(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    return this.budget.setLinks(ctx, id, pid, parse(z.object({ laneIds: z.array(zId).max(200), taskIds: z.array(zId).max(1000) }), body));
  }

  @Post('costs')
  @UseInterceptors(upload())
  addCost(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown, @UploadedFile() file?: Express.Multer.File) {
    return this.budget.addCost(ctx, id, parse(zCost, body), file);
  }

  @Patch('costs/:cid')
  updateCost(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('cid') cid: string, @Body() body: unknown) {
    return this.budget.updateCost(ctx, id, cid, parse(zCost.partial(), body));
  }

  @Delete('costs/:cid')
  deleteCost(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('cid') cid: string) {
    return this.budget.deleteCost(ctx, id, cid);
  }

  @Get('costs.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="costs.csv"')
  csv(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.budget.costsCsv(ctx, id);
  }
}

@Controller('projects/:id')
@UseGuards(TenantGuard)
export class MembersController {
  constructor(private members: MembersService) {}

  @Get('members')
  list(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.members.list(ctx, id);
  }

  @Post('members')
  add(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    return this.members.add(ctx, id, parse(z.object({ accountId: zId, role: z.enum(['COLEAD', 'CONTRIBUTOR']) }), body));
  }

  @Patch('members/:mid')
  setRole(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('mid') mid: string, @Body() body: unknown) {
    return this.members.setRole(ctx, id, mid, parse(z.object({ role: z.enum(['COLEAD', 'CONTRIBUTOR']) }), body).role);
  }

  @Delete('members/:mid')
  remove(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('mid') mid: string) {
    return this.members.remove(ctx, id, mid);
  }

  @Post('tasks/:tid/links')
  createLink(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('tid') tid: string, @Body() body: unknown) {
    const b = parse(
      z.object({
        guestName: zName,
        guestEmail: z.string().trim().toLowerCase().email().max(254),
        guestOrg: zText(200).optional(),
        canComment: z.boolean().default(true),
        canFiles: z.boolean().default(true),
        untilDone: z.boolean().default(true),
        days: z.number().int().min(1).max(365).default(90),
      }),
      body,
    );
    return this.members.createLink(ctx, id, tid, b);
  }

  @Post('links/:lid/resend')
  @HttpCode(200)
  resend(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('lid') lid: string) {
    return this.members.resendLink(ctx, id, lid);
  }

  @Delete('links/:lid')
  revoke(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('lid') lid: string) {
    return this.members.revokeLink(ctx, id, lid);
  }
}

@Controller('me')
@UseGuards(TenantGuard)
export class MyController {
  constructor(private tasks: TasksService) {}

  @Get('tasks')
  myTasks(@CurrentCtx() ctx: Ctx) {
    return this.tasks.myTasks(ctx);
  }
}
