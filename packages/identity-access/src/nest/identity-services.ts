import type { HttpRuntime } from '@hmedic/http-kit';
import type { OtpDeliveryPort, PasswordResetNotifierPort, PatientContextPort } from '../application/ports';
import { Argon2idHasher } from '../infrastructure/argon2-hasher';
import { CsrfService } from '../infrastructure/csrf';
import { MockOtpDelivery, OtpService } from '../infrastructure/otp-service';
import {
  MockPasswordResetNotifier,
  NoopPasswordResetNotifier,
  PasswordAuthService,
} from '../infrastructure/password-auth';
import { SessionService } from '../infrastructure/session-service';
import { TenantContextResolver } from '../infrastructure/tenant-context';
import { JoseTokenService } from '../infrastructure/token-service';
import { PlatformOperatorService } from '../infrastructure/platform-operators';

export const IDENTITY_SERVICES = Symbol('IDENTITY_SERVICES');

export interface IdentityServices {
  sessions: SessionService;
  passwordAuth: PasswordAuthService;
  otp: OtpService;
  csrf: CsrfService;
  tenants: TenantContextResolver;
  operators: PlatformOperatorService;
  /** Present only in development/test with OTP_PROVIDER=mock (dev inbox). */
  mockOtp: MockOtpDelivery | null;
  /** Present only in development/test (dev inbox). */
  mockReset: MockPasswordResetNotifier | null;
  cookies: { refreshName: string; csrfName: string; secure: boolean };
  /** Registered by the api composition root with the patient context's resolver (Stage 5). */
  patientContexts: PatientContextPort | null;
  /** Called after a successful OTP login with the verified phone (patient auto-link, AUTHORIZATION §4). */
  onOtpVerified: ((userId: string, phoneE164: string) => Promise<void>) | null;
}

/**
 * Composes the identity services from configuration. `otpDelivery` is injected by the api composition root
 * (SMS adapter in SMS-005); without it, OTP_PROVIDER=mock uses MockOtpDelivery (refused in production by
 * config).
 */
export function createIdentityServices(
  runtime: HttpRuntime,
  overrides: { otpDelivery?: OtpDeliveryPort } = {},
): IdentityServices {
  const c = runtime.config;
  const local = c.APP_ENV === 'development' || c.APP_ENV === 'test';
  const tokens = new JoseTokenService(
    {
      issuer: c.JWT_ISSUER,
      audience: c.JWT_AUDIENCE,
      ttlSeconds: c.JWT_ACCESS_TTL_SECONDS,
      signingKeyId: c.JWT_SIGNING_KEY_ID,
      signingPrivateKeyPem: c.JWT_SIGNING_PRIVATE_KEY,
      verificationKeysJson: c.JWT_VERIFICATION_KEYS,
    },
    runtime.clock,
  );
  const sessions = new SessionService(
    runtime.prisma,
    tokens,
    {
      idleHoursWeb: c.SESSION_IDLE_TIMEOUT_HOURS_WEB,
      idleHoursMobile: c.SESSION_IDLE_TIMEOUT_HOURS_MOBILE,
      absoluteDaysWeb: c.SESSION_ABSOLUTE_TIMEOUT_DAYS_WEB,
      absoluteDaysMobile: c.SESSION_ABSOLUTE_TIMEOUT_DAYS_MOBILE,
      refreshPepper: c.REFRESH_TOKEN_PEPPER,
      operatorIdleMinutes: c.PLATFORM_OPERATOR_SESSION_IDLE_MINUTES,
    },
    runtime.audit,
    runtime.clock,
  );
  const hasher = new Argon2idHasher({
    memoryKiB: c.ARGON2_MEMORY_KIB,
    timeCost: c.ARGON2_TIME_COST,
    parallelism: c.ARGON2_PARALLELISM,
  });
  const mockReset = local ? new MockPasswordResetNotifier() : null;
  const resetNotifier: PasswordResetNotifierPort = mockReset ?? new NoopPasswordResetNotifier();
  const mockOtp = !overrides.otpDelivery && c.OTP_PROVIDER === 'mock' ? new MockOtpDelivery() : null;
  const otpDelivery = overrides.otpDelivery ?? mockOtp;
  if (!otpDelivery) throw new Error('OTP_PROVIDER=sms requires an OtpDeliveryPort (SMS adapter)');
  const passwordAuth = new PasswordAuthService(
    runtime.prisma,
    hasher,
    sessions,
    runtime.rateLimiter,
    runtime.audit,
    resetNotifier,
    c.REFRESH_TOKEN_PEPPER,
    runtime.clock,
  );
  const otp = new OtpService(
    runtime.prisma,
    otpDelivery,
    sessions,
    runtime.rateLimiter,
    runtime.audit,
    { otpPepper: c.OTP_PEPPER, ttlSeconds: c.OTP_TTL_SECONDS, channel: mockOtp ? 'MOCK' : 'SMS' },
    runtime.clock,
    runtime.metrics,
  );
  const devCookies = c.AUTH_COOKIE_DEV_MODE && local;
  return {
    sessions,
    passwordAuth,
    otp,
    csrf: new CsrfService(c.CSRF_SECRET),
    tenants: new TenantContextResolver(runtime.prisma),
    operators: new PlatformOperatorService(runtime.prisma, runtime.audit, runtime.clock),
    mockOtp: local ? mockOtp : null,
    mockReset,
    patientContexts: null,
    onOtpVerified: null,
    cookies: devCookies
      ? { refreshName: 'hm_rt', csrfName: 'hm_csrf', secure: false }
      : { refreshName: '__Host-hm_rt', csrfName: '__Host-hm_csrf', secure: true },
  };
}
