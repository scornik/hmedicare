// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/health_live.dart';
import '../models/health_ready.dart';

part 'health_client.g.dart';

@RestApi()
abstract class HealthClient {
  factory HealthClient(Dio dio, {String? baseUrl}) = _HealthClient;

  /// Process liveness
  @GET('/health/live')
  Future<HealthLive> getHealthLive();

  /// Readiness (DB, job lag on the worker)
  @GET('/health/ready')
  Future<HealthReady> getHealthReady();
}
