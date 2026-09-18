// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';

import 'clients/auth_client.dart';
import 'clients/tenant_client.dart';
import 'clients/me_client.dart';
import 'clients/platform_client.dart';
import 'clients/health_client.dart';

/// HMedic API `v1.0.0`.
///
/// HMedic clinic platform API. Generated from packages/contracts (do not edit the JSON by hand). Business routes live under /api/v1; health routes at the root.
class HmApiClient {
  HmApiClient(
    Dio dio, {
    String? baseUrl,
  })  : _dio = dio,
        _baseUrl = baseUrl;

  final Dio _dio;
  final String? _baseUrl;

  static String get version => '1.0.0';

  AuthClient? _auth;
  TenantClient? _tenant;
  MeClient? _me;
  PlatformClient? _platform;
  HealthClient? _health;

  AuthClient get auth => _auth ??= AuthClient(_dio, baseUrl: _baseUrl);

  TenantClient get tenant => _tenant ??= TenantClient(_dio, baseUrl: _baseUrl);

  MeClient get me => _me ??= MeClient(_dio, baseUrl: _baseUrl);

  PlatformClient get platform => _platform ??= PlatformClient(_dio, baseUrl: _baseUrl);

  HealthClient get health => _health ??= HealthClient(_dio, baseUrl: _baseUrl);
}
