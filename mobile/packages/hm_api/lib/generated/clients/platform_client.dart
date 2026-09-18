// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/bootstrap_tenant_request.dart';
import '../models/post_api_v1_tenants_response.dart';
import '../models/x_platform_context.dart';

part 'platform_client.g.dart';

@RestApi()
abstract class PlatformClient {
  factory PlatformClient(Dio dio, {String? baseUrl}) = _PlatformClient;

  /// Platform operators only (X-Platform-Context: operator, platform.tenants.bootstrap).
  @POST('/api/v1/tenants')
  Future<PostApiV1TenantsResponse> bootstrapTenant({
    @Header('X-Platform-Context') required XPlatformContext xPlatformContext,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() BootstrapTenantRequest? body,
  });
}
