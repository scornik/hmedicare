import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@hmedic/kernel';
import { type PrismaClient, pendingTimelineEventIds } from '@hmedic/database';
import type { HistoryMetadataPort, HistoryReference } from '../application/history-port';
import { isTimelineEntryRedacted } from '../application/redaction';

const Cursor = z
  .object({
    at: z.string().datetime(),
    id: z.string().uuid(),
    upper: z.number().int().nonnegative(),
    exp: z.number().int(),
  })
  .strict();
export interface TimelineReadAccess {
  tenantId: string;
  patientId: string;
  view: 'clinical' | 'operational' | 'patient';
  /** Includes authenticated user and current role/scope. Changing context invalidates continuation. */
  binding: string;
  canRead(ref: HistoryReference): Promise<boolean>;
}
const eventNames: Record<string, string> = {
  encounter_started: 'EncounterStarted',
  encounter_completed: 'EncounterCompleted',
};
export class TimelineReader {
  private readonly key: Buffer;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sources: readonly HistoryMetadataPort[],
    private readonly version: number,
    secret: string,
  ) {
    this.key = createHash('sha256').update(`hmedic:timeline:cursor:v1:${secret}`).digest();
  }
  private aad(access: TimelineReadAccess) {
    return Buffer.from(
      JSON.stringify([access.tenantId, access.patientId, access.view, access.binding, this.version]),
    );
  }
  private encode(access: TimelineReadAccess, value: z.infer<typeof Cursor>) {
    const nonce = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(this.aad(access));
    return Buffer.concat([
      nonce,
      cipher.update(JSON.stringify(value)),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64url');
  }
  private decode(access: TimelineReadAccess, cursor: string) {
    try {
      if (!/^[A-Za-z0-9_-]{40,512}$/.test(cursor)) throw new Error();
      const bytes = Buffer.from(cursor, 'base64url');
      const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
      cipher.setAAD(this.aad(access));
      cipher.setAuthTag(bytes.subarray(-16));
      const value = Cursor.parse(
        JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString()),
      );
      if (value.exp <= Date.now()) throw new Error();
      return value;
    } catch {
      throw new AppError('VALIDATION_FAILED');
    }
  }
  private port(kind: string) {
    return this.sources.find((source) => source.kinds.includes(kind));
  }
  async list(access: TimelineReadAccess, options: { limit?: number; cursor?: string } = {}) {
    const limit = options.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError('VALIDATION_FAILED');
    const key = { tenantId: access.tenantId, patientId: access.patientId, projectionVersion: this.version };
    const cursor = options.cursor ? this.decode(access, options.cursor) : null;
    const upper =
      cursor?.upper ??
      (await this.prisma.timelineEvent.aggregate({ where: key, _max: { seq: true } }))._max.seq ??
      0;
    // Read all markers, including clinical markers which mask patient-shared descendants.
    const markers = await this.prisma.timelineEvent.findMany({ where: { ...key, eventType: 'REDACTED' } });
    const items: Array<{
      id: string;
      eventType: string;
      occurredAt: string;
      summary: string;
      visibility: string;
      source: { type: string; id: string; aggregateId: string; encounterId: string | null } | null;
    }> = [];
    const cache = new Map<string, Promise<HistoryReference[]>>();
    const resolve = (kind: string, id: string) => {
      const cacheKey = `${kind}:${id}`;
      if (!cache.has(cacheKey))
        cache.set(cacheKey, this.port(kind)?.read(access.tenantId, kind, id) ?? Promise.resolve([]));
      return cache.get(cacheKey)!;
    };
    let after = cursor ? { at: new Date(cursor.at), id: cursor.id } : null;
    let unresolved = false,
      exhausted = false,
      scanned = 0;
    // Bounded work per request, even when a long history consists solely of hidden records.
    while (items.length <= limit && scanned < 1000 && !exhausted) {
      const batch = await this.prisma.timelineEvent.findMany({
        where: {
          ...key,
          seq: { lte: upper },
          ...(after
            ? { OR: [{ occurredAt: { lt: after.at } }, { occurredAt: after.at, id: { lt: after.id } }] }
            : {}),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 100,
      });
      exhausted = batch.length < 100;
      for (const row of batch) {
        scanned++;
        if (items.length === limit) {
          // Continue from the last examined row, not the unexamined next row.
          return {
            items,
            nextCursor: this.encode(access, {
              at: after!.at.toISOString(),
              id: after!.id,
              upper,
              exp: cursor?.exp ?? Date.now() + 900_000,
            }),
            projectionVersion: this.version,
            stale: await this.stale(access.tenantId, unresolved),
          };
        }
        after = { at: row.occurredAt, id: row.id };
        if (access.view === 'patient' && row.visibility !== 'PATIENT_SHARED') continue;
        if (access.view === 'operational' && row.visibility !== 'OPERATIONAL') continue;
        if (isTimelineEntryRedacted(row, markers)) continue;
        const refs = await resolve(row.sourceType, row.sourceId);
        const ref = refs.find(
          (r) =>
            r.sourceId === row.sourceId &&
            (!eventNames[row.eventType] || r.eventName === eventNames[row.eventType]),
        );
        if (!ref || ref.patientId !== access.patientId) {
          unresolved = true;
          continue;
        }
        if (!(await access.canRead(ref))) continue;
        if (row.eventType !== 'REDACTED') {
          if (ref.redactedAt) continue;
          // Fail closed against the live source as well as projection markers.
          if (access.view === 'patient' && ref.visibility !== 'PATIENT_SHARED') continue;
          if (ref.encounterId) {
            const parent = (await resolve('encounter', ref.encounterId))[0];
            if (!parent || parent.patientId !== access.patientId) {
              unresolved = true;
              continue;
            }
            if (parent.redactedAt) continue;
          }
        }
        items.push({
          id: row.id,
          eventType: row.eventType,
          occurredAt: row.occurredAt.toISOString(),
          summary:
            row.eventType === 'doctor_note' && ref.eventName === 'EncounterNoteAmended'
              ? 'Note amended'
              : row.summary,
          visibility: row.visibility,
          source:
            row.eventType === 'REDACTED'
              ? null
              : {
                  type: ref.sourceType,
                  id: ref.sourceId,
                  aggregateId: ref.aggregateId,
                  encounterId: ref.encounterId ?? null,
                },
        });
      }
    }
    return {
      items,
      nextCursor:
        !exhausted && after
          ? this.encode(access, {
              at: after.at.toISOString(),
              id: after.id,
              upper,
              exp: cursor?.exp ?? Date.now() + 900_000,
            })
          : null,
      projectionVersion: this.version,
      stale: await this.stale(access.tenantId, unresolved),
    };
  }
  private async stale(tenantId: string, unresolved: boolean) {
    if (unresolved || (await pendingTimelineEventIds(this.prisma, tenantId, this.version, 1)).length)
      return true;
    const pages = await this.prisma.job.findMany({
      where: {
        tenantId,
        type: 'BackfillTimelineSources',
        OR: [
          { idempotencyKey: `BackfillTimelineSources:${tenantId}:v${this.version}` },
          { idempotencyKey: { startsWith: `BackfillTimelineSources:${tenantId}:v${this.version}:` } },
        ],
      },
      select: { status: true, payload: true, idempotencyKey: true },
    });
    return (
      !pages.some(
        (p) =>
          p.idempotencyKey === `BackfillTimelineSources:${tenantId}:v${this.version}` &&
          p.status === 'SUCCEEDED',
      ) ||
      !pages.some(
        (p) =>
          p.payload && typeof p.payload === 'object' && 'kind' in p.payload && p.payload.kind === 'document',
      ) ||
      pages.some((p) => p.status !== 'SUCCEEDED')
    );
  }
}
