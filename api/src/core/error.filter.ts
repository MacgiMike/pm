import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Turns database errors into sensible HTTP answers instead of 500s. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
      res.status(status).json({ statusCode: status, ...payload });
      return;
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025' || exception.code === 'P2023') {
        res.status(404).json({ statusCode: 404, message: 'Not found' });
        return;
      }
      if (exception.code === 'P2002') {
        res.status(409).json({ statusCode: 409, message: 'That already exists' });
        return;
      }
      if (exception.code === 'P2003') {
        res.status(409).json({ statusCode: 409, message: 'This is still in use elsewhere' });
        return;
      }
    }
    const msg = (exception as Error)?.message ?? String(exception);
    if (/invalid input syntax for type uuid|Error creating UUID/i.test(msg)) {
      res.status(404).json({ statusCode: 404, message: 'Not found' });
      return;
    }
    if ((exception as { code?: string })?.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ statusCode: 413, message: 'That file is too large' });
      return;
    }
    this.log.error(msg, (exception as Error)?.stack);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: 'Something went wrong on our side. Please try again.' });
  }
}
