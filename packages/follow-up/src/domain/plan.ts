import { AppError } from '@hmedic/kernel';
import { z } from 'zod';
export const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });
export const CreateFollowUp = z
  .object({
    dueStartDate: localDate,
    dueEndDate: localDate.nullable().optional(),
    reason: z.string().trim().min(1).max(300),
    instructions: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine((v) => !v.dueEndDate || v.dueEndDate >= v.dueStartDate, { path: ['dueEndDate'] });
export const UpdateFollowUp = z
  .object({
    expectedRowVersion: z.number().int().positive(),
    dueStartDate: localDate.optional(),
    dueEndDate: localDate.nullable().optional(),
    reason: z.string().trim().min(1).max(300).optional(),
    instructions: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(['COMPLETED', 'CANCELLED', 'MISSED']).optional(),
  })
  .strict();
export function requireTransition(from: string, to: string) {
  const allowed: Record<string, string[]> = {
    PLANNED: ['BOOKED', 'COMPLETED', 'CANCELLED', 'MISSED'],
    BOOKED: ['COMPLETED', 'CANCELLED', 'MISSED'],
  };
  if (!allowed[from]?.includes(to)) throw new AppError('INVALID_TRANSITION');
}
/** Local dates are stored as DATE; reminders use the start of that day in Asia/Dhaka. */
export const dueInstant = (date: string) => new Date(`${date}T00:00:00+06:00`);
