// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/create_clinic_request.dart';
import '../models/get_api_v1_clinics_response.dart';
import '../models/patch_api_v1_clinics_id_response.dart';
import '../models/post_api_v1_clinics_response.dart';
import '../models/update_clinic_request.dart';

part 'clinics_client.g.dart';

@RestApi()
abstract class ClinicsClient {
  factory ClinicsClient(Dio dio, {String? baseUrl}) = _ClinicsClient;

  @GET('/api/v1/clinics')
  Future<GetApiV1ClinicsResponse> listClinics({
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/clinics')
  Future<PostApiV1ClinicsResponse> createClinic({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() CreateClinicRequest? body,
  });

  @PATCH('/api/v1/clinics/{id}')
  Future<PatchApiV1ClinicsIdResponse> updateClinic({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() UpdateClinicRequest? body,
  });
}
