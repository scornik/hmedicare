import { Controller, Get, Inject, Param } from '@nestjs/common';
import { AppError } from '@hmedic/kernel';
import { Public, RawResponse } from '@hmedic/http-kit';
import { IDENTITY_SERVICES, type IdentityServices } from '@hmedic/identity-access/nest';

/**
 * Development/test inbox for mock OTP codes and password-reset tokens (AUTH §2.1 "Mock provider"). The
 * controller is registered only when APP_ENV is development or test and the mock delivery is active; it is
 * never part of staging/production builds of the module graph.
 */
@Public()
@Controller('internal/test')
export class DevInboxController {
  constructor(@Inject(IDENTITY_SERVICES) private readonly identity: IdentityServices) {}

  @Get('otp/:challengeId')
  @RawResponse()
  otp(@Param('challengeId') challengeId: string) {
    const code = this.identity.mockOtp?.codeFor(challengeId);
    if (!code) throw new AppError('RESOURCE_NOT_FOUND');
    return { code };
  }

  @Get('password-reset/:userId')
  @RawResponse()
  reset(@Param('userId') userId: string) {
    const token = this.identity.mockReset?.latestFor(userId);
    if (!token) throw new AppError('RESOURCE_NOT_FOUND');
    return { token };
  }
}
