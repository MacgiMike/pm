import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.set('trust proxy', 1); // behind Traefik
  app.disable('x-powered-by');
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });

  const allowedOrigin = new URL(config.appUrl).origin;
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (!req.path.startsWith('/api/public/') && !req.path.startsWith('/api/r/')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    // CSRF: state-changing browser requests must come from our own origin.
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (unsafe && req.path !== '/api/billing/webhook') {
      const origin = req.headers.origin;
      if (origin && origin !== allowedOrigin && process.env.NODE_ENV === 'production') {
        res.status(403).json({ statusCode: 403, message: 'Cross-site request blocked' });
        return;
      }
    }
    next();
  });

  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  new Logger('Lockred').log(`API listening on :${config.port} for ${config.appUrl}`);
}

bootstrap();
