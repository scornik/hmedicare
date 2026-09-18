// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/api_v1_auth_step_up_otp_request_request_body.dart';
import '../models/delete_api_v1_auth_session_response.dart';
import '../models/otp_request_request.dart';
import '../models/otp_verify_request.dart';
import '../models/password_login_request.dart';
import '../models/password_reset_complete.dart';
import '../models/password_reset_request.dart';
import '../models/post_api_v1_auth_otp_request_response.dart';
import '../models/post_api_v1_auth_otp_verify_response.dart';
import '../models/post_api_v1_auth_password_login_response.dart';
import '../models/post_api_v1_auth_password_reset_complete_response.dart';
import '../models/post_api_v1_auth_password_reset_request_response.dart';
import '../models/post_api_v1_auth_session_csrf_response.dart';
import '../models/post_api_v1_auth_session_logout_all_response.dart';
import '../models/post_api_v1_auth_session_refresh_response.dart';
import '../models/post_api_v1_auth_step_up_otp_request_response.dart';
import '../models/post_api_v1_auth_step_up_otp_verify_response.dart';
import '../models/refresh_request.dart';
import '../models/step_up_verify_request.dart';

part 'auth_client.g.dart';

@RestApi()
abstract class AuthClient {
  factory AuthClient(Dio dio, {String? baseUrl}) = _AuthClient;

  @POST('/api/v1/auth/otp/request')
  Future<PostApiV1AuthOtpRequestResponse> requestOtp({
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() OtpRequestRequest? body,
  });

  @POST('/api/v1/auth/otp/verify')
  Future<PostApiV1AuthOtpVerifyResponse> verifyOtp({
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() OtpVerifyRequest? body,
  });

  @POST('/api/v1/auth/password/login')
  Future<PostApiV1AuthPasswordLoginResponse> passwordLogin({
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() PasswordLoginRequest? body,
  });

  @POST('/api/v1/auth/password/reset/complete')
  Future<PostApiV1AuthPasswordResetCompleteResponse> completePasswordReset({
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() PasswordResetComplete? body,
  });

  @POST('/api/v1/auth/password/reset/request')
  Future<PostApiV1AuthPasswordResetRequestResponse> requestPasswordReset({
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() PasswordResetRequest? body,
  });

  @DELETE('/api/v1/auth/session')
  Future<DeleteApiV1AuthSessionResponse> logout();

  /// Web reload: new CSRF token from the refresh cookie (allowed Origin required).
  @POST('/api/v1/auth/session/csrf')
  Future<PostApiV1AuthSessionCsrfResponse> issueCsrfToken();

  @POST('/api/v1/auth/session/logout-all')
  Future<PostApiV1AuthSessionLogoutAllResponse> logoutAll();

  /// Web: __Host-hm_rt cookie + X-CSRF-Token + allowed Origin. Mobile: refreshToken in the body.
  @POST('/api/v1/auth/session/refresh')
  Future<PostApiV1AuthSessionRefreshResponse> refreshSession({
    @Body() RefreshRequest? body,
  });

  /// Sends a code to the signed-in user phone (verified). Platform operators need pwd + otp per session.
  @POST('/api/v1/auth/step-up/otp/request')
  Future<PostApiV1AuthStepUpOtpRequestResponse> requestStepUpOtp({
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ApiV1AuthStepUpOtpRequestRequestBody? body,
  });

  @POST('/api/v1/auth/step-up/otp/verify')
  Future<PostApiV1AuthStepUpOtpVerifyResponse> verifyStepUpOtp({
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() StepUpVerifyRequest? body,
  });
}
