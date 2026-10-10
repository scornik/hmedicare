import { z } from 'zod';
import { AppError, type Clock, newId, systemClock } from '@hmedic/kernel';
import { type PrismaClient, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { ProviderCredentialVault } from '@hmedic/provider-credentials';
import type { SmsProvider, SmsCredentialHandle, SmsBalanceResult } from '../application/sms-ports';
const Amount = /^\d{1,10}(?:\.\d{1,2})?$/;
const Create = z
  .object({
    apiKey: z.string().min(8).max(256).regex(/^\S+$/),
    senderId: z
      .string()
      .min(1)
      .max(11)
      .regex(/^[A-Za-z0-9 _-]+$/),
    balanceAlertBdt: z.string().regex(Amount).optional(),
  })
  .strict();
export class SmsAccountService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly vault: ProviderCredentialVault,
    private readonly provider: SmsProvider,
    private readonly audit: PrismaAuditPort,
    private readonly defaultAlertBdt: string,
    private readonly clock: Clock = systemClock,
  ) {}
  private async auditRead(tenantId: string | null, userId: string, action: string, resourceId?: string) {
    await withTransaction(this.prisma, (tx) =>
      this.audit.append(tx, {
        tenantId,
        actorUserId: userId,
        actorType: tenantId ? 'USER' : 'OPERATOR',
        action,
        resourceType: 'sms_account',
        resourceId: resourceId ?? null,
        outcome: 'SUCCESS',
        metadata: {},
      }),
    );
  }
  async list(tenantId: string, userId: string) {
    const result = await this.vault.list(tenantId, 'SMS');
    await this.auditRead(tenantId, userId, 'SMS_CREDENTIALS_READ');
    return result;
  }
  async create(tenantId: string, userId: string, raw: unknown) {
    const parsed = Create.safeParse(raw);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    return this.vault.create({
      tenantId,
      actorUserId: userId,
      providerKind: 'SMS',
      providerCode: 'zamanit',
      environment: 'na',
      publicIdentifier: parsed.data.senderId,
      bundle: { apiKey: parsed.data.apiKey },
      last4Field: 'apiKey',
      balanceAlertBdt: parsed.data.balanceAlertBdt ?? this.defaultAlertBdt,
    });
  }
  async revoke(tenantId: string, userId: string, id: string) {
    const row = await this.vault.getView(tenantId, id, 'SMS');
    if (row.status === 'REVOKED') return row;
    try {
      return await this.vault.revoke(tenantId, id, userId);
    } catch (error) {
      if (error instanceof AppError && error.code === 'INVALID_TRANSITION') {
        const current = await this.vault.getView(tenantId, id, 'SMS');
        if (current.status === 'REVOKED') return current;
      }
      throw error;
    }
  }
  async validate(tenantId: string, userId: string, id: string, rowVersion: number) {
    if (!Number.isInteger(rowVersion) || rowVersion < 1) throw new AppError('VALIDATION_FAILED');
    const handle = await this.vault.resolveForAdapter(tenantId, id, [
      'PENDING_VALIDATION',
      'ACTIVE',
      'SUSPENDED_BALANCE',
      'INVALID',
    ]);
    const view = await this.vault.getView(tenantId, id, 'SMS');
    if (
      handle.providerCode !== 'zamanit' ||
      view.rowVersion !== rowVersion ||
      handle.rowVersion !== rowVersion
    )
      throw new AppError('STALE_VERSION');
    const smsHandle: SmsCredentialHandle = {
      scope: 'TENANT',
      tenantId,
      credentialId: id,
      senderId: handle.publicIdentifier ?? '',
      withKey: (fn) => handle.use((bundle) => fn(bundle.apiKey ?? '')),
    };
    let result: SmsBalanceResult;
    try {
      result = await this.provider.checkBalance(smsHandle);
    } catch {
      result = { outcome: 'ERROR', errorClass: 'PROVIDER_UNAVAILABLE' };
    }
    const validAmount =
      result.outcome === 'OK' &&
      result.parseStatus === 'PARSED' &&
      result.balance !== null &&
      Amount.test(result.balance);
    const balance = validAmount && result.outcome === 'OK' ? result.balance : null;
    const parseStatus = result.outcome === 'OK' ? (validAmount ? 'PARSED' : 'UNPARSED') : 'ERROR';
    const errorClass = result.outcome === 'OK' ? null : result.errorClass;
    const status = validAmount
      ? Number(balance) > 0
        ? 'ACTIVE'
        : 'SUSPENDED_BALANCE'
      : result.outcome === 'REJECTED' &&
          ['INVALID_CREDENTIAL', 'SENDER_ID_INVALID'].includes(result.errorClass)
        ? 'INVALID'
        : null;
    const credential = await withTransaction(this.prisma, async (tx) => {
      const updated = await this.vault.completeSmsValidation(
        tx,
        tenantId,
        id,
        rowVersion,
        status,
        status === 'SUSPENDED_BALANCE' ? 'INSUFFICIENT_BALANCE' : errorClass,
        userId,
      );
      await tx.smsBalanceSnapshot.create({
        data: {
          id: newId(),
          tenantId,
          credentialScope: 'TENANT',
          credentialId: id,
          providerCode: this.provider.code,
          balance,
          currencyText: result.outcome === 'OK' ? (result.currencyText?.slice(0, 8) ?? null) : null,
          parseStatus,
          errorClass,
          checkedAt: this.clock.now(),
        },
      });
      return updated;
    });
    return { credential, balance: await this.balance(tenantId, userId, id) };
  }
  async balance(tenantId: string, userId: string, id: string) {
    await this.vault.getView(tenantId, id, 'SMS');
    const row = await this.prisma.smsBalanceSnapshot.findFirst({
      where: { tenantId, credentialId: id, credentialScope: 'TENANT' },
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
    });
    await this.auditRead(tenantId, userId, 'SMS_BALANCE_READ', id);
    return row
      ? {
          balance: row.balance?.toFixed(2) ?? null,
          currencyText: row.currencyText,
          parseStatus: row.parseStatus,
          errorClass: row.errorClass,
          checkedAt: row.checkedAt.toISOString(),
        }
      : null;
  }
  async platformBalance(userId: string) {
    const rows = await this.prisma.smsBalanceSnapshot.findMany({
      where: {
        credentialScope: 'PLATFORM',
        checkedAt: { gte: new Date(this.clock.now().getTime() - 30 * 86400000) },
      },
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
      take: 10001,
      select: { balance: true, checkedAt: true, parseStatus: true, currencyText: true, errorClass: true },
    });
    const truncated = rows.length > 10000;
    const kept = rows.slice(0, 10000);
    const daily = new Map<string, number>();
    let previous: number | null = null;
    for (const row of [...kept].reverse()) {
      const current =
        row.parseStatus === 'PARSED' && row.balance !== null ? Math.round(Number(row.balance) * 100) : null;
      if (previous !== null && current !== null && previous > current) {
        const day = new Date(row.checkedAt.getTime() + 6 * 3600000).toISOString().slice(0, 10);
        daily.set(day, (daily.get(day) ?? 0) + previous - current);
      }
      previous = current;
    }
    await this.auditRead(null, userId, 'PLATFORM_SMS_BALANCE_READ');
    return {
      latest: kept[0]
        ? {
            balance: kept[0].balance?.toFixed(2) ?? null,
            currencyText: kept[0].currencyText,
            parseStatus: kept[0].parseStatus,
            errorClass: kept[0].errorClass,
            checkedAt: kept[0].checkedAt.toISOString(),
          }
        : null,
      trend: kept.map((row) => ({
        checkedAt: row.checkedAt.toISOString(),
        balance: row.balance?.toFixed(2) ?? null,
        parseStatus: row.parseStatus,
      })),
      dailySpendEstimate: [...daily].map(([day, cents]) => ({ day, estimateBdt: (cents / 100).toFixed(2) })),
      truncated,
    };
  }
}
