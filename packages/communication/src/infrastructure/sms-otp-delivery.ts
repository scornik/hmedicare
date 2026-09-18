import { type PrismaClient, withTransaction } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import type { Logger, Metrics } from '@hmedic/observability';
import type { SmsCredentialHandle, SmsProvider } from '../application/sms-ports';
import { renderTemplate } from '../domain/sms-templates';

type OtpOutcome = 'ACCEPTED' | 'REJECTED' | 'PROVIDER_UNAVAILABLE' | 'UNKNOWN_OUTCOME';

/** Platform-account credential from env (ADR-018 §6 `PLATFORM_ACCOUNT`); the key stays in this closure. */
export function platformSmsCredential(apiKey: string, senderId: string): SmsCredentialHandle {
  return {
    scope: 'PLATFORM',
    credentialId: null,
    tenantId: null,
    senderId,
    withKey: (fn) => fn(apiKey),
  };
}

/**
 * SmsOtpDelivery (ADR-018 §1): identity-access `OtpDeliveryPort` implemented over the `SmsProvider` port
 * with the platform account. Synchronous; never retries (a resend is a new challenge). Credential and
 * balance failures alert; a refused plain-HTTP transport is a security event.
 */
export class SmsOtpDelivery {
  constructor(
    private readonly provider: SmsProvider,
    private readonly credential: SmsCredentialHandle,
    private readonly deps: {
      appName: string;
      prisma: PrismaClient;
      audit: PrismaAuditPort;
      logger: Logger;
      metrics: Metrics;
    },
  ) {}

  async send(message: {
    challengeId: string;
    phoneE164: string;
    code: string;
    purpose: 'LOGIN' | 'PHONE_VERIFY' | 'RECOVERY';
    locale: 'bn-BD' | 'en-BD';
    ttlSeconds: number;
  }): Promise<{ outcome: OtpOutcome; errorClass?: string }> {
    const key = message.purpose === 'PHONE_VERIFY' ? 'otp_phone_verify' : 'otp_login';
    const text = renderTemplate(key, message.locale, {
      appName: this.deps.appName,
      otpCode: message.code,
      otpMinutes: String(Math.ceil(message.ttlSeconds / 60)),
    });
    const started = Date.now();
    const result = await this.provider.send({
      credential: this.credential,
      destination: message.phoneE164,
      text,
      purpose: 'OTP',
      correlationId: message.challengeId,
    });
    const errorClass = result.outcome === 'ACCEPTED' ? 'none' : result.errorClass;
    this.deps.metrics.smsSend.inc({
      provider: this.provider.code,
      purpose: 'OTP',
      outcome: result.outcome,
      error_class: errorClass,
      credential_scope: 'PLATFORM',
    });
    this.deps.metrics.smsLatency.observe(
      { provider: this.provider.code, operation: 'send' },
      (Date.now() - started) / 1000,
    );
    if (result.outcome === 'ACCEPTED') {
      this.deps.metrics.smsSegments.inc(
        { encoding: result.encoding, credential_scope: 'PLATFORM' },
        result.segmentsEstimated,
      );
    }

    if (result.outcome === 'REJECTED') {
      const alert = [
        'INVALID_CREDENTIAL',
        'SENDER_ID_INVALID',
        'INSUFFICIENT_BALANCE',
        'TRANSPORT_REFUSED',
      ].includes(result.errorClass);
      (alert ? this.deps.logger.error : this.deps.logger.warn).call(
        this.deps.logger,
        { errorClass: result.errorClass, challengeId: message.challengeId, alert },
        'OTP SMS rejected',
      );
      if (result.errorClass === 'TRANSPORT_REFUSED') {
        await withTransaction(this.deps.prisma, (tx) =>
          this.deps.audit.append(tx, {
            tenantId: null,
            actorUserId: null,
            actorType: 'SYSTEM',
            action: 'SMS_HTTP_GATE_REFUSED',
            resourceType: 'otp_challenge',
            resourceId: message.challengeId,
            outcome: 'DENIED',
            metadata: { gate: 'GATE-SMS-HTTP' },
          }),
        );
      }
      return { outcome: 'REJECTED', errorClass: result.errorClass };
    }
    if (result.outcome !== 'ACCEPTED') {
      this.deps.logger.warn(
        { errorClass, challengeId: message.challengeId },
        'OTP SMS outcome not confirmed',
      );
      return { outcome: result.outcome, errorClass };
    }
    return { outcome: 'ACCEPTED' };
  }
}
