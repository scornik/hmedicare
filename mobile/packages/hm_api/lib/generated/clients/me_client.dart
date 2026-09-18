// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/delete_api_v1_me_sessions_id_response.dart';
import '../models/get_api_v1_me_patient_contexts_response.dart';
import '../models/get_api_v1_me_response.dart';
import '../models/get_api_v1_me_sessions_response.dart';
import '../models/get_api_v1_me_tenant_context_response.dart';

part 'me_client.g.dart';

@RestApi()
abstract class MeClient {
  factory MeClient(Dio dio, {String? baseUrl}) = _MeClient;

  @GET('/api/v1/me')
  Future<GetApiV1MeResponse> getMe();

  @GET('/api/v1/me/patient-contexts')
  Future<GetApiV1MePatientContextsResponse> listPatientContexts();

  @GET('/api/v1/me/sessions')
  Future<GetApiV1MeSessionsResponse> listMySessions();

  @DELETE('/api/v1/me/sessions/{id}')
  Future<DeleteApiV1MeSessionsIdResponse> revokeMySession({
    @Path('id') required String id,
  });

  @GET('/api/v1/me/tenant-context')
  Future<GetApiV1MeTenantContextResponse> getTenantContext({
    @Header('X-Tenant-ID') required String xTenantId,
  });
}
