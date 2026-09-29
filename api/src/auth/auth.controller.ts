import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { AllowMfaPending, AppRequest, clientIp, CurrentCtx, Public } from '../core/guards';
import { Ctx } from '../core/context';
import { parse, zEmail, zName } from '../core/util';
import { AuthService } from './auth.service';

const strict = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Throttle(strict)
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const b = parse(z.object({ email: zEmail, password: z.string().min(1).max(200) }), body);
    return this.auth.login(res, b.email, b.password, clientIp(req), req.headers['user-agent']);
  }

  @AllowMfaPending()
  @Throttle(strict)
  @Post('mfa')
  @HttpCode(200)
  mfa(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ code: z.string().min(6).max(10) }), body);
    return this.auth.completeMfa(ctx, b.code);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.endSession(res, req.ctx?.sessionId);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentCtx() ctx: Ctx) {
    return this.auth.me(ctx);
  }

  @Post('switch')
  @HttpCode(200)
  switch(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ slug: z.string().min(1).max(60) }), body);
    return this.auth.switchTenant(ctx, b.slug);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('signup')
  signup(@Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const b = parse(
      z.object({
        company: zName,
        slug: z.string().trim().toLowerCase().min(3).max(40),
        name: zName,
        email: zEmail,
        password: z.string().max(200),
        acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Please accept the terms of service' }) }),
      }),
      body,
    );
    const ref = (req as any).cookies?.[config.refCookie] as string | undefined;
    return this.auth.signup(res, b, ref, clientIp(req), req.headers['user-agent']);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot')
  @HttpCode(200)
  async forgot(@Body() body: unknown) {
    const b = parse(z.object({ email: zEmail }), body);
    await this.auth.forgot(b.email);
    return { ok: true };
  }

  @Public()
  @Throttle(strict)
  @Post('reset')
  @HttpCode(200)
  reset(@Body() body: unknown) {
    const b = parse(z.object({ token: z.string().min(10).max(200), password: z.string().max(200) }), body);
    return this.auth.reset(b.token, b.password);
  }

  @Public()
  @Get('invite/:token')
  inviteInfo(@Param('token') token: string) {
    return this.auth.inviteInfo(token);
  }

  @Public()
  @Throttle(strict)
  @Post('invite/:token')
  @HttpCode(200)
  acceptInvite(@Param('token') token: string, @Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const b = parse(z.object({ name: z.string().max(200).optional(), password: z.string().min(1).max(200) }), body);
    return this.auth.acceptInvite(res, token, b, clientIp(req), req.headers['user-agent']);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@CurrentCtx() ctx: Ctx) {
    return this.auth.mfaSetup(ctx);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  mfaEnable(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    return this.auth.mfaEnable(ctx, parse(z.object({ code: z.string().min(6).max(10) }), body).code);
  }

  @Post('mfa/disable')
  @HttpCode(200)
  mfaDisable(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    return this.auth.mfaDisable(ctx, parse(z.object({ code: z.string().min(6).max(10) }), body).code);
  }

  @Patch('profile')
  profile(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    return this.auth.updateProfile(ctx, parse(z.object({ name: zName }), body).name);
  }

  @Throttle(strict)
  @Post('password')
  @HttpCode(200)
  password(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ current: z.string().max(200), next: z.string().max(200) }), body);
    return this.auth.changePassword(ctx, b.current, b.next);
  }
}
