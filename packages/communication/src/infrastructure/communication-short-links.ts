import { createHmac, randomInt } from 'node:crypto';
import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, type Tx, lockRow, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { CommunicationReminderSource } from '../application/ports/communication-source';
import type { CommunicationActor } from './communication-service';

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const validToken = /^[0-9A-Za-z]{22}$/;
const maxTtlSeconds = 7 * 86400;
const active = ['QUEUED', 'SENDING', 'RETRY_SCHEDULED', 'SENT', 'DELIVERED', 'READ'];

/** Internal facade: resolution requires an already-authorized, live patient context from the caller.
 * Tokens locate records; they never grant access. No public redirect or HTTP route is provided here.
 */
export class CommunicationShortLinks {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: PrismaAuditPort,
    private readonly reminders: CommunicationReminderSource<Tx>,
    private readonly key: string,
    private readonly clock: Clock = systemClock,
  ) {
    if (Buffer.byteLength(key) < 32) throw new Error('Short-link key must contain at least 32 bytes');
  }
  private hash(token: string) {
    return createHmac('sha256', this.key)
      .update('hmedic:communication-short-link:v1:')
      .update(token)
      .digest('hex');
  }
  private async eligible(tx: Tx, tenantId: string, patientId: string, communicationId: string) {
    if (!(await lockRow(tx, 'patients', patientId, tenantId))) return false;
    if (!(await tx.patient.count({ where: { id: patientId, tenantId, status: 'ACTIVE' } }))) return false;
    const intent = await tx.communication.findFirst({
      where: { id: communicationId, tenantId, patientId, status: { in: active } },
    });
    if (intent?.businessType !== 'follow_up_plan' || intent.purpose !== 'follow_up_reminder') return false;
    if (!(await this.reminders.eligible(tx, tenantId, patientId, intent.businessId))) return false;
    // Same patient/source/communication lock order as delivery and preference writes.
    if (!(await lockRow(tx, 'communications', communicationId, tenantId))) return false;
    return (
      (await tx.communication.count({
        where: { id: communicationId, tenantId, patientId, status: { in: active } },
      })) === 1
    );
  }
  async issue(tenantId: string, communicationId: string, ttlSeconds = maxTtlSeconds) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > maxTtlSeconds)
      throw new AppError('VALIDATION_FAILED');
    return withTransaction(this.prisma, async (tx) => {
      const intent = await tx.communication.findFirst({ where: { tenantId, id: communicationId } });
      if (!intent?.patientId || !(await this.eligible(tx, tenantId, intent.patientId, intent.id)))
        throw new AppError('RESOURCE_NOT_FOUND');
      const token = Array.from({ length: 22 }, () => alphabet[randomInt(alphabet.length)]).join('');
      const now = this.clock.now(),
        expiresAt = new Date(now.getTime() + ttlSeconds * 1000),
        id = newId();
      await tx.communicationShortLink.create({
        data: {
          id,
          tenantId,
          tokenHash: this.hash(token),
          targetType: 'COMMUNICATION',
          targetId: intent.id,
          createdAt: now,
          expiresAt,
        },
      });
      await this.audit.append(tx, {
        tenantId,
        actorUserId: null,
        actorType: 'SYSTEM',
        action: 'COMMUNICATION_LINK_CREATED',
        resourceType: 'communication_short_link',
        resourceId: id,
        outcome: 'SUCCESS',
        metadata: {},
      });
      return { token, expiresAt: expiresAt.toISOString() };
    });
  }
  async resolve(tenantId: string, patientId: string, token: string, actor: CommunicationActor) {
    if (!validToken.test(token)) throw new AppError('RESOURCE_NOT_FOUND');
    return withTransaction(this.prisma, async (tx) => {
      const link = await tx.communicationShortLink.findFirst({
        where: { tenantId, tokenHash: this.hash(token), expiresAt: { gt: this.clock.now() } },
      });
      if (
        !link ||
        link.targetType !== 'COMMUNICATION' ||
        !(await this.eligible(tx, tenantId, patientId, link.targetId))
      )
        throw new AppError('RESOURCE_NOT_FOUND');
      // Recheck expiry after waiting for source locks. Parallel opens set the first-use time once.
      const now = this.clock.now();
      if (link.expiresAt.getTime() <= now.getTime()) throw new AppError('RESOURCE_NOT_FOUND');
      await tx.communicationShortLink.updateMany({
        where: { id: link.id, tenantId, firstUsedAt: null },
        data: { firstUsedAt: now },
      });
      await this.audit.append(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: 'COMMUNICATION_LINK_RESOLVED',
        resourceType: 'communication_short_link',
        resourceId: link.id,
        outcome: 'SUCCESS',
        requestId: actor.requestId ?? null,
        metadata: { actingAs: actor.actingAs ?? 'SELF' },
      });
      // No clinical prose, source identifiers or arbitrary redirect destinations leave this facade.
      return { targetType: 'PATIENT_TIMELINE' as const, patientId };
    });
  }
}
