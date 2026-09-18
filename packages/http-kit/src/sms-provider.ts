import type { SmsProvider } from '@hmedic/communication';
import { MockSmsAdapter } from '@hmedic/communication-adapters-mock';
import { ZamanItSmsAdapter, probeZamanItBalance } from '@hmedic/communication-adapters-zamanit';
import { GateDecisionReader } from '@hmedic/secrets';
import { type SmsRuntime, createSmsRuntime, registerCommunicationJobs } from '@hmedic/communication/worker';
import {
  createProviderCredentialVault,
  registerProviderCredentialJobs,
} from '@hmedic/provider-credentials/worker';
import { type JobComposition, composeJobs } from './job-composition';
import type { HttpRuntime } from './runtime';

/**
 * Adapter selection for the composition roots (`SMS_PROVIDER`, ADR-018): Zaman IT with the fail-closed
 * production transport gate (GATE-SMS-HTTP via GateDecisionReader), or the in-process mock.
 */
export function createSmsProvider(runtime: Pick<HttpRuntime, 'config' | 'prisma' | 'clock'>): SmsProvider {
  const c = runtime.config;
  if (c.SMS_PROVIDER !== 'zamanit') return new MockSmsAdapter();
  const gate = new GateDecisionReader(runtime.prisma, runtime.clock);
  return new ZamanItSmsAdapter({
    baseUrl: c.ZAMANIT_BASE_URL!,
    timeoutMs: c.ZAMANIT_TIMEOUT_MS,
    allowInsecureHttp: c.ZAMANIT_ALLOW_INSECURE_HTTP,
    appEnv: c.APP_ENV,
    isHttpGateClosed: () => gate.isClosed('GATE-SMS-HTTP', 'production'),
  });
}

/** SMS runtime (platform credential, OTP delivery when OTP_PROVIDER=sms) for a composition root. */
export function createSmsServices(runtime: HttpRuntime): SmsRuntime {
  return createSmsRuntime(
    {
      config: runtime.config,
      prisma: runtime.prisma,
      audit: runtime.audit,
      clock: runtime.clock,
      logger: runtime.logger,
      metrics: runtime.metrics,
    },
    createSmsProvider(runtime),
  );
}

/**
 * SMS-002 diagnostics for the platform account: the redacted Zaman IT `checkbalance` capture + TLS probe, or
 * the mock adapter result. Same transport rules as the adapter (GATE-SMS-HTTP in production).
 */
export function createSmsDiagnostics(runtime: HttpRuntime, sms: SmsRuntime): () => Promise<unknown> {
  const c = runtime.config;
  if (c.SMS_PROVIDER !== 'zamanit') {
    return async () => ({
      provider: sms.provider.code,
      balance: await sms.provider.checkBalance(sms.platform),
    });
  }
  const gate = new GateDecisionReader(runtime.prisma, runtime.clock);
  return () =>
    probeZamanItBalance(
      {
        baseUrl: c.ZAMANIT_BASE_URL!,
        timeoutMs: c.ZAMANIT_TIMEOUT_MS,
        allowInsecureHttp: c.ZAMANIT_ALLOW_INSECURE_HTTP,
        appEnv: c.APP_ENV,
        isHttpGateClosed: () => gate.isClosed('GATE-SMS-HTTP', 'production'),
      },
      sms.platform,
    );
}

/**
 * The platform job set shared by the worker and the api in embedded/cron mode: maintenance, chain
 * verification (composeJobs), CheckSmsBalance and ReencryptProviderCredentials.
 */
export function composePlatformJobs(runtime: HttpRuntime, sms: SmsRuntime): JobComposition | null {
  const vault = createProviderCredentialVault(runtime.config, runtime.prisma, runtime.audit, runtime.clock);
  return composeJobs(runtime, ({ registry, runner }) => [
    ...registerCommunicationJobs(registry, runner, {
      config: runtime.config,
      prisma: runtime.prisma,
      audit: runtime.audit,
      clock: runtime.clock,
      logger: runtime.logger,
      metrics: runtime.metrics,
      sms,
      vault,
    }),
    ...registerProviderCredentialJobs(registry, runner, vault),
  ]);
}
