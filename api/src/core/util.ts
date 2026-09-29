import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z, ZodTypeAny } from 'zod';

export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue?.path?.join('.') || 'input';
    throw new BadRequestException({ message: `${field}: ${issue?.message ?? 'invalid'}`, issues: r.error.issues });
  }
  return r.data;
}

export const notFound = (what = 'Not found') => new NotFoundException(what);
export const forbidden = (why = 'You don’t have access to do that') => new ForbiddenException(why);
export const badRequest = (why: string) => new BadRequestException(why);

/** Decimal / null → number / null */
export function num(v: Prisma.Decimal | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : Number(v.toString());
}
export function numOrNull(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' ? v : Number(v.toString());
}

/** 'YYYY-MM-DD' for a DATE column value */
export function ymd(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/** Parse 'YYYY-MM-DD' into a UTC midnight Date */
export function dateOnly(s: string): Date {
  const d = new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid date: ${s}`);
  return d;
}

export function todayUtc(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

// Common zod pieces
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
export const zId = z.string().uuid();
export const zMoney = z.coerce.number().min(0).max(1e12);
export const zText = (max = 500) => z.string().trim().max(max);
export const zName = z.string().trim().min(1, 'required').max(200);
export const zEmail = z.string().trim().toLowerCase().email().max(254);
