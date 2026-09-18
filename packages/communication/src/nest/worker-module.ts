import type { ServerConfig } from '@hmedic/config';
import type { PrismaClient } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { Clock } from '@hmedic/kernel';
import type { Logger, Metrics } from '@hmedic/observability';
import { type JobRegistry, type JobRunner, OutboxPort, type PeriodicJob } from '@hmedic/jobs';
import type { ProviderCredentialVault } from '@hmedic/provider-credentials';
import type { SmsCredentialHandle, SmsProvider } from '../application/sms-ports';
import { SmsOtpDelivery, platformSmsCredential } from '../infrastructure/sms-otp-delivery';
import { registerSmsBalanceCheck } from '../infrastructure/sms-balance';

export interface SmsRuntimeDeps {
  config: ServerConfig;
  prisma: PrismaClient;
  audit: PrismaAuditPort;
  clock: Clock;
  logger: Logger;
  metrics: Metrics;
}

export interface SmsRuntime {
  provider: SmsProvider;
  platform: SmsCredentialHandle;
  /** Present when OTP_PROVIDER=sms (identity-access OtpDeliveryPort). */
  otpDelivery: SmsOtpDelivery | null;
}

/**
 * SMS composition (ADR-018 §1, SMS-005): the platform-account credential (env; the key stays in a closure)
 * and, when `OTP_PROVIDER=sms`, the OTP delivery bridge. The adapter is chosen by the composition root
 * (`SMS_PROVIDER`), so this context never depends on adapter packages.
 */
export function createSmsRuntime(deps: SmsRuntimeDeps, provider: SmsProvider): SmsRuntime {
  const c = deps.config;
  const zamanit = c.SMS_PROVIDER === 'zamanit';
  const platform = zamanit
    ? platformSmsCredential(c.ZAMANIT_API_KEY!, c.ZAMANIT_SENDER_ID!)
    : platformSmsCredential('mock-platform-key', 'HMEDIC');
  const otpDelivery =
    c.OTP_PROVIDER === 'sms'
      ? new SmsOtpDelivery(provider, platform, {
          appName: 'HMedic',
          prisma: deps.prisma,
          audit: deps.audit,
          logger: deps.logger,
          metrics: deps.metrics,
        })
      : null;
  return { provider, platform, otpDelivery };
}

/** Maps a vault handle to an SMS credential handle (the key is read inside the adapter call only). */
function tenantHandle(
  h: Awaited<ReturnType<ProviderCredentialVault['resolveForAdapter']>>,
): SmsCredentialHandle {
  return {
    scope: 'TENANT',
    credentialId: h.credentialId,
    tenantId: h.tenantId,
    senderId: h.publicIdentifier ?? '',
    withKey: (fn) => h.use((bundle) => fn(bundle.apiKey ?? '')),
  };
}

/** Worker job registration: CheckSmsBalance for the platform account and tenant credentials. */
export function registerCommunicationJobs(
  registry: JobRegistry,
  runner: JobRunner | null,
  deps: SmsRuntimeDeps & { sms: SmsRuntime; vault: ProviderCredentialVault },
): PeriodicJob[] {
  const c = deps.config;
  return registerSmsBalanceCheck(
    registry,
    runner,
    {
      prisma: deps.prisma,
      provider: deps.sms.provider,
      platform: c.SMS_PROVIDER === 'zamanit' ? deps.sms.platform : null,
      tenants: {
        list: async () =>
          (await deps.vault.listSmsForBalanceCheck()).map((x) => ({
            handle: tenantHandle(x.handle),
            status: x.status,
            balanceAlertBdt: x.balanceAlertBdt,
          })),
        setStatus: (tenantId, credentialId, status, errorClass) =>
          deps.vault.setStatus(tenantId, credentialId, status, errorClass),
      },
      outbox: new OutboxPort(deps.clock),
      platformAlertBdt: c.ZAMANIT_BALANCE_ALERT_BDT,
      keyIssuedOn: c.ZAMANIT_API_KEY_ISSUED_ON,
      keyMaxAgeDays: c.ZAMANIT_KEY_MAX_AGE_DAYS,
      logger: deps.logger,
      metrics: deps.metrics,
      clock: deps.clock,
    },
    c.ZAMANIT_BALANCE_CHECK_MINUTES,
  );
}
