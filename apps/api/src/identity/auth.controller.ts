import { Body, Controller, Delete, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { AppError, type ActorContext } from '@hmedic/kernel';
import { withTransaction } from '@hmedic/database';
import {
  OtpRequestRequest,
  OtpVerifyRequest,
  PasswordLoginRequest,
  PasswordResetComplete,
  PasswordResetRequest,
  RefreshRequest,
} from '@hmedic/contracts';
import {
  HTTP_RUNTIME,
  type HttpRuntime,
  Idempotent,
  Public,
  parseAllowedOrigins,
  parseCookies,
  serializeCookie,
} from '@hmedic/http-kit';
import { hashForLog } from '@hmedic/observability';
import type { OtpRequestHint } from '@hmedic/identity-access';
import { CurrentActor, IDENTITY_SERVICES, type IdentityServices } from '@hmedic/identity-access/nest';
import { loadMeUser } from './me.controller';

class PasswordLoginDto extends createZodDto(PasswordLoginRequest) {}
class OtpRequestDto extends createZodDto(OtpRequestRequest) {}
class OtpVerifyDto extends createZodDto(OtpVerifyRequest) {}
class RefreshDto extends createZodDto(RefreshRequest) {}
class ResetRequestDto extends createZodDto(PasswordResetRequest) {}
class ResetCompleteDto extends createZodDto(PasswordResetComplete) {}

type Client = 'web' | 'android' | 'ios';
const CLIENT_TYPE = { web: 'WEB', android: 'ANDROID', ios: 'IOS' } as const;

interface IssuedSession {
  userId: string;
  sessionId: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  access: { token: string; expiresAt: Date };
}

/** Shared web/mobile session response (AUTH §2.1 step 3). */
async function sessionResponse(
  runtime: HttpRuntime,
  identity: IdentityServices,
  reply: FastifyReply,
  s: IssuedSession,
  client: Client,
) {
  const user = await loadMeUser(runtime, s.userId);
  const base = { accessToken: s.access.token, accessTokenExpiresAt: s.access.expiresAt.toISOString(), user };
  if (client !== 'web') {
    return { ...base, refreshToken: s.refreshToken, refreshTokenExpiresAt: s.refreshExpiresAt.toISOString() };
  }
  const csrfToken = identity.csrf.issue(s.sessionId);
  setSessionCookies(identity, reply, s.refreshToken, csrfToken, s.refreshExpiresAt, runtime.clock.now());
  return { ...base, csrfToken };
}

function setSessionCookies(
  identity: IdentityServices,
  reply: FastifyReply,
  refreshToken: string,
  csrfToken: string,
  expiresAt: Date,
  now: Date,
) {
  const { refreshName, csrfName, secure } = identity.cookies;
  const maxAge = (expiresAt.getTime() - now.getTime()) / 1000;
  void reply.header('set-cookie', [
    serializeCookie(refreshName, refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge,
    }),
    serializeCookie(csrfName, csrfToken, { httpOnly: true, secure, sameSite: 'Strict', path: '/', maxAge }),
  ]);
}

function clearSessionCookies(identity: IdentityServices, reply: FastifyReply) {
  const { refreshName, csrfName, secure } = identity.cookies;
  void reply.header('set-cookie', [
    serializeCookie(refreshName, '', { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 0 }),
    serializeCookie(csrfName, '', { httpOnly: true, secure, sameSite: 'Strict', path: '/', maxAge: 0 }),
  ]);
}

function requestMeta(runtime: HttpRuntime, req: FastifyRequest) {
  return { ip: req.ip, ipHash: hashForLog(req.ip, runtime.config.LOG_HASH_PEPPER), requestId: req.id };
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Public authentication routes (API-IMPLEMENTATION §3.2). */
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
    @Inject(IDENTITY_SERVICES) private readonly identity: IdentityServices,
  ) {}

  /** Cookie endpoints require an allowed Origin (ADR-013 §2, T17). */
  private assertOrigin(req: FastifyRequest): void {
    const origin = header(req, 'origin');
    const allowed = new Set(parseAllowedOrigins(this.runtime.config.CORS_ALLOWED_ORIGINS));
    if (!origin || !allowed.has(origin)) throw new AppError('CSRF_FAILED');
  }

  @Post('password/login')
  @HttpCode(200)
  @Idempotent('required', { replay: 'refuse' })
  async login(
    @Body() dto: PasswordLoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const s = await this.identity.passwordAuth.login(dto.email, dto.password, {
      ...requestMeta(this.runtime, req),
      clientType: CLIENT_TYPE[dto.client],
      deviceLabel: dto.deviceLabel ?? null,
    });
    return sessionResponse(this.runtime, this.identity, reply, s, dto.client);
  }

  @Post('otp/request')
  @HttpCode(202)
  @Idempotent('required')
  async requestOtp(
    @Body() dto: OtpRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<{ challengeId: string; expiresAt: string; hint: OtpRequestHint }> {
    const deviceId = header(req, 'x-device-id');
    const r = await this.identity.otp.request({
      phone: dto.phone,
      purpose: dto.purpose,
      locale: dto.locale,
      ip: req.ip,
      ipHash: hashForLog(req.ip, this.runtime.config.LOG_HASH_PEPPER),
      ...(deviceId ? { deviceId } : {}),
    });
    return { challengeId: r.challengeId, expiresAt: r.expiresAt.toISOString(), hint: r.hint };
  }

  @Post('otp/verify')
  @HttpCode(200)
  @Idempotent('required', { replay: 'refuse' })
  async verifyOtp(
    @Body() dto: OtpVerifyDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const s = await this.identity.otp.verifyLogin({
      phone: dto.phone,
      code: dto.code,
      clientType: CLIENT_TYPE[dto.client],
      deviceLabel: dto.deviceLabel ?? null,
      ...requestMeta(this.runtime, req),
    });
    return sessionResponse(this.runtime, this.identity, reply, s, dto.client);
  }

  /**
   * Web: refresh cookie + X-CSRF-Token (== csrf cookie, signed for the session) + allowed Origin.
   * Mobile: `refreshToken` in the body; cookies are ignored.
   */
  @Post('session/refresh')
  @HttpCode(200)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (dto.refreshToken) {
      const s = await this.identity.sessions.refresh(dto.refreshToken, { requestId: req.id });
      return sessionResponse(
        this.runtime,
        this.identity,
        reply,
        s,
        s.clientType === 'IOS' ? 'ios' : 'android',
      );
    }
    this.assertOrigin(req);
    const cookies = parseCookies(header(req, 'cookie'));
    const raw = cookies[this.identity.cookies.refreshName];
    if (!raw) throw new AppError('UNAUTHENTICATED');
    const sessionId = await this.identity.sessions.peekSessionId(raw);
    if (!sessionId) throw new AppError('UNAUTHENTICATED');
    if (
      !this.identity.csrf.verify(
        sessionId,
        header(req, 'x-csrf-token'),
        cookies[this.identity.cookies.csrfName],
      )
    ) {
      throw new AppError('CSRF_FAILED');
    }
    const s = await this.identity.sessions.refresh(raw, { requestId: req.id });
    return sessionResponse(this.runtime, this.identity, reply, s, 'web');
  }

  /** Web reload: a fresh CSRF token from the refresh cookie (the access token lives only in memory). */
  @Post('session/csrf')
  @HttpCode(200)
  async csrf(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.assertOrigin(req);
    const cookies = parseCookies(header(req, 'cookie'));
    const raw = cookies[this.identity.cookies.refreshName];
    const sessionId = raw ? await this.identity.sessions.peekSessionId(raw) : null;
    if (!raw || !sessionId) throw new AppError('UNAUTHENTICATED');
    const session = await this.runtime.prisma.session.findUnique({ where: { id: sessionId } });
    const now = this.runtime.clock.now();
    if (!session || session.revokedAt || session.idleExpiresAt <= now) throw new AppError('UNAUTHENTICATED');
    const csrfToken = this.identity.csrf.issue(sessionId);
    setSessionCookies(this.identity, reply, raw, csrfToken, session.absoluteExpiresAt, now);
    return { csrfToken };
  }

  @Post('password/reset/request')
  @HttpCode(202)
  @Idempotent('required')
  async requestReset(@Body() dto: ResetRequestDto, @Req() req: FastifyRequest) {
    await this.identity.passwordAuth.requestReset(dto.email, {
      ip: req.ip,
      requestId: req.id,
      locale: dto.locale,
    });
    return null;
  }

  @Post('password/reset/complete')
  @HttpCode(200)
  @Idempotent('required')
  async completeReset(@Body() dto: ResetCompleteDto, @Req() req: FastifyRequest) {
    await this.identity.passwordAuth.completeReset(dto.token, dto.newPassword, { requestId: req.id });
    return null;
  }
}

/** Authenticated session routes (logout, logout-all). */
@Controller('auth/session')
export class SessionController {
  constructor(
    @Inject(HTTP_RUNTIME) private readonly runtime: HttpRuntime,
    @Inject(IDENTITY_SERVICES) private readonly identity: IdentityServices,
  ) {}

  private async auditLogout(actor: ActorContext, req: FastifyRequest, all: boolean) {
    await withTransaction(this.runtime.prisma, (tx) =>
      this.runtime.audit.append(tx, {
        tenantId: null,
        actorUserId: actor.userId,
        actorType: 'USER',
        action: all ? 'AUTH_LOGOUT_ALL' : 'AUTH_LOGOUT',
        resourceType: 'session',
        resourceId: actor.sessionId,
        outcome: 'SUCCESS',
        requestId: req.id,
        metadata: {},
      }),
    );
  }

  @Delete()
  @HttpCode(200)
  async logout(
    @CurrentActor() actor: ActorContext,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.identity.sessions.revoke(actor.sessionId, 'LOGOUT');
    await this.auditLogout(actor, req, false);
    clearSessionCookies(this.identity, reply);
    return null;
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(
    @CurrentActor() actor: ActorContext,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.identity.sessions.revokeAll(actor.userId, 'LOGOUT_ALL');
    await this.auditLogout(actor, req, true);
    clearSessionCookies(this.identity, reply);
    return null;
  }
}
