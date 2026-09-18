import type { PrismaClient } from '../client';
import { withTransaction } from '../tx';

/**
 * Fallback singleton when GET_LOCK is unavailable (ADR-015 §7, HOST-004): a `singleton_locks` row
 * acquired with SELECT … FOR UPDATE and renewed while held.
 */
export async function acquireSingletonLease(
  prisma: PrismaClient,
  name: string,
  holder: string,
  leaseSeconds: number,
  now: Date = new Date(),
): Promise<boolean> {
  return withTransaction(prisma, async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ holder: string; lease_expires_at: Date }>>(
      'SELECT holder, lease_expires_at FROM singleton_locks WHERE name = ? FOR UPDATE',
      name,
    );
    const expires = new Date(now.getTime() + leaseSeconds * 1000);
    const current = rows[0];
    if (!current) {
      await tx.singletonLock.create({ data: { name, holder, leaseExpiresAt: expires, updatedAt: now } });
      return true;
    }
    if (current.holder === holder || new Date(current.lease_expires_at).getTime() <= now.getTime()) {
      await tx.singletonLock.update({
        where: { name },
        data: { holder, leaseExpiresAt: expires, updatedAt: now },
      });
      return true;
    }
    return false;
  });
}

export async function releaseSingletonLease(
  prisma: PrismaClient,
  name: string,
  holder: string,
): Promise<void> {
  await prisma.singletonLock.deleteMany({ where: { name, holder } });
}
