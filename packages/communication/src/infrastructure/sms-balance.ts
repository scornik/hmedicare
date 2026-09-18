import { z } from 'zod';
import { type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, withTransaction } from '@hmedic/database';
import type { Logger, Metrics } from '@hmedic/observability';
import {
  type JobRegistry,
  type JobRunner,
  MAINTENANCE_QUEUE,
  type OutboxPort,
  type PeriodicJob,
} from '@hmedic/jobs';
import type { SmsBalanceResult, SmsCredentialHandle, SmsProvider } from '../application/sms-ports';

export const CHECK_SMS_BALANCE_JOB = 'CheckSmsBalance';

export interface TenantSmsCredentialSource {
  /** ACTIVE or SUSPENDED_BALANCE tenant SMS credentials (vault handles; key never leaves the process). */
  list(): Promise<Array<{ handle: SmsCredentialHandle; status: string; balanceAlertBdt: string | null }>>;
  setStatus(
    tenantId: string,
    credentialId: string,
    status: 'ACTIVE' | 'SUSPENDED_BALANCE' | 'INVALID',
    errorClass: string | null,
  ): Promise<void>;
}

export interface SmsBalanceDeps {
  prisma: PrismaClient;
  provider: SmsProvider;
  platform: SmsCredentialHandle | null;
  tenants?: TenantSmsCredentialSource;
  outbox: OutboxPort;
  platformAlertBdt: string;
  keyIssuedOn?: string | undefined;
  keyMaxAgeDays: number;
  logger: Logger;
  metrics: Metrics;
  clock?: Clock;
}

function below(balance: string | null, threshold: string | null): boolean {
  return balance !== null && threshold !== null && Number(balance) < Number(threshold);
}

/**
 * CheckSmsBalance (ADR-018 §7, COMMUNICATION §6.4): checks the platform account and tenant credentials
 * (checkbalance sends nothing and costs nothing), stores `sms_balance_snapshots`, emits `SmsBalanceLow`
 * (no amount in the payload) below the threshold, reactivates SUSPENDED_BALANCE credentials above it, and
 * reports platform key age against ZAMANIT_KEY_MAX_AGE_DAYS.
 */
export async function runSmsBalanceCheck(deps: SmsBalanceDeps): Promise<{ checked: number; low: number }> {
  const clock = deps.clock ?? systemClock;
  let checked = 0;
  let low = 0;
  const record = async (
    handle: SmsCredentialHandle,
    result: SmsBalanceResult,
    threshold: string | null,
  ): Promise<boolean> => {
    const now = clock.now();
    const parsed = result.outcome === 'OK' && result.parseStatus === 'PARSED' ? result.balance : null;
    const isLow = below(parsed, threshold);
    await withTransaction(deps.prisma, async (tx) => {
      await tx.smsBalanceSnapshot.create({
        data: {
          id: newId(),
          tenantId: handle.tenantId,
          credentialScope: handle.scope,
          credentialId: handle.credentialId,
          providerCode: deps.provider.code,
          balance: parsed,
          currencyText: result.outcome === 'OK' ? result.currencyText : null,
          parseStatus: result.outcome === 'OK' ? result.parseStatus : 'ERROR',
          errorClass: result.outcome === 'OK' ? null : result.errorClass,
          checkedAt: now,
        },
      });
      if (isLow) {
        await deps.outbox.append(tx, {
          tenantId: handle.tenantId,
          eventName: 'SmsBalanceLow',
          eventVersion: 1,
          aggregateType: 'sms_credential',
          aggregateId: handle.credentialId ?? '00000000-0000-7000-8000-000000000000',
          payload: { v: 1, credentialScope: handle.scope, credentialId: handle.credentialId ?? 'platform' },
          correlationId: newId(),
          causationId: null,
          actorId: null,
          idempotencyKey: null,
        });
      }
    });
    if (result.outcome === 'OK' && result.parseStatus === 'UNPARSED') {
      deps.logger.error({ credentialScope: handle.scope, alert: true }, 'SMS balance response unparsed');
    }
    if (isLow)
      deps.logger.error({ credentialScope: handle.scope, alert: true }, 'SMS balance below threshold');
    return isLow;
  };

  if (deps.platform) {
    const r = await deps.provider.checkBalance(deps.platform);
    checked++;
    if (r.outcome === 'OK' && r.parseStatus === 'PARSED')
      deps.metrics.smsBalance.set({ credential_scope: 'PLATFORM' }, Number(r.balance));
    if (r.outcome === 'REJECTED')
      deps.logger.error({ errorClass: r.errorClass, alert: true }, 'platform SMS credential rejected');
    if (await record(deps.platform, r, deps.platformAlertBdt)) low++;
    if (deps.keyIssuedOn) {
      const ageDays = Math.floor(
        (clock.now().getTime() - new Date(`${deps.keyIssuedOn}T00:00:00Z`).getTime()) / 86_400_000,
      );
      deps.metrics.smsKeyAge.set({ credential_scope: 'PLATFORM' }, ageDays);
      if (ageDays > deps.keyMaxAgeDays)
        deps.logger.warn({ ageDays, alert: true }, 'platform SMS key older than ZAMANIT_KEY_MAX_AGE_DAYS');
    }
  }
  for (const c of (await deps.tenants?.list()) ?? []) {
    const r = await deps.provider.checkBalance(c.handle);
    checked++;
    const isLow = await record(c.handle, r, c.balanceAlertBdt);
    if (isLow) low++;
    const tenantId = c.handle.tenantId!;
    const credentialId = c.handle.credentialId!;
    if (r.outcome === 'REJECTED' && r.errorClass === 'INVALID_CREDENTIAL') {
      await deps.tenants!.setStatus(tenantId, credentialId, 'INVALID', r.errorClass);
    } else if (r.outcome === 'OK' && r.parseStatus === 'PARSED') {
      if (c.status === 'SUSPENDED_BALANCE' && !isLow)
        await deps.tenants!.setStatus(tenantId, credentialId, 'ACTIVE', null);
      if (c.status === 'ACTIVE' && isLow && Number(r.balance) <= 0) {
        await deps.tenants!.setStatus(tenantId, credentialId, 'SUSPENDED_BALANCE', 'INSUFFICIENT_BALANCE');
      }
    }
  }
  return { checked, low };
}

/** Registers CheckSmsBalance on the maintenance queue (singleton by the runner lock; every N minutes). */
export function registerSmsBalanceCheck(
  registry: JobRegistry,
  runner: JobRunner | null,
  deps: SmsBalanceDeps,
  everyMinutes: number,
): PeriodicJob[] {
  registry.register({
    type: CHECK_SMS_BALANCE_JOB,
    queue: MAINTENANCE_QUEUE,
    payloadSchema: z.object({ v: z.literal(1), window: z.number().int() }),
    maxAttempts: 2,
    leaseSeconds: 120,
    priority: 220,
  });
  runner?.handle(CHECK_SMS_BALANCE_JOB, async () => {
    await runSmsBalanceCheck(deps);
  });
  return [{ type: CHECK_SMS_BALANCE_JOB, everyMs: everyMinutes * 60_000 }];
}
