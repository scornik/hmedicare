// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/api_v1_tenant_sms_credentials_id_validate_request_body.dart';
import '../models/api_v1_tenant_sms_credentials_request_body.dart';
import '../models/delete_api_v1_tenant_sms_credentials_id_response.dart';
import '../models/get_api_v1_platform_sms_balance_response.dart';
import '../models/get_api_v1_tenant_sms_credentials_id_balance_response.dart';
import '../models/get_api_v1_tenant_sms_credentials_response.dart';
import '../models/post_api_v1_tenant_sms_credentials_id_validate_response.dart';
import '../models/post_api_v1_tenant_sms_credentials_response.dart';
import '../models/x_platform_context.dart';

part 'sms_accounts_client.g.dart';

@RestApi()
abstract class SmsAccountsClient {
  factory SmsAccountsClient(Dio dio, {String? baseUrl}) = _SmsAccountsClient;

  @GET('/api/v1/platform/sms/balance')
  Future<GetApiV1PlatformSmsBalanceResponse> readPlatformSmsBalance({
    @Header('X-Platform-Context') required XPlatformContext xPlatformContext,
  });

  @GET('/api/v1/tenant/sms-credentials')
  Future<GetApiV1TenantSmsCredentialsResponse> listSmsCredentials({
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/tenant/sms-credentials')
  Future<PostApiV1TenantSmsCredentialsResponse> createSmsCredential({
    @Header('X-Tenant-ID') required String xTenantId,
    @Body() ApiV1TenantSmsCredentialsRequestBody? body,
  });

  @DELETE('/api/v1/tenant/sms-credentials/{id}')
  Future<DeleteApiV1TenantSmsCredentialsIdResponse> revokeSmsCredential({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @GET('/api/v1/tenant/sms-credentials/{id}/balance')
  Future<GetApiV1TenantSmsCredentialsIdBalanceResponse> readSmsCredentialBalance({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/tenant/sms-credentials/{id}/validate')
  Future<PostApiV1TenantSmsCredentialsIdValidateResponse> validateSmsCredential({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Body() ApiV1TenantSmsCredentialsIdValidateRequestBody? body,
  });
}
