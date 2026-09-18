// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/create_membership_request.dart';
import '../models/get_api_v1_doctor_coverages_response.dart';
import '../models/get_api_v1_memberships_response.dart';
import '../models/grant_coverage_request.dart';
import '../models/patch_api_v1_memberships_id_response.dart';
import '../models/post_api_v1_doctor_coverages_id_revoke_response.dart';
import '../models/post_api_v1_doctor_coverages_response.dart';
import '../models/post_api_v1_memberships_response.dart';
import '../models/revoke_coverage_request.dart';
import '../models/update_membership_request.dart';

part 'tenant_client.g.dart';

@RestApi()
abstract class TenantClient {
  factory TenantClient(Dio dio, {String? baseUrl}) = _TenantClient;

  @GET('/api/v1/doctor-coverages')
  Future<GetApiV1DoctorCoveragesResponse> listCoverages({
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/doctor-coverages')
  Future<PostApiV1DoctorCoveragesResponse> grantCoverage({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() GrantCoverageRequest? body,
  });

  @POST('/api/v1/doctor-coverages/{id}/revoke')
  Future<PostApiV1DoctorCoveragesIdRevokeResponse> revokeCoverage({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() RevokeCoverageRequest? body,
  });

  @GET('/api/v1/memberships')
  Future<GetApiV1MembershipsResponse> listMemberships({
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/memberships')
  Future<PostApiV1MembershipsResponse> createMembership({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() CreateMembershipRequest? body,
  });

  @PATCH('/api/v1/memberships/{id}')
  Future<PatchApiV1MembershipsIdResponse> updateMembership({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Body() UpdateMembershipRequest? body,
  });
}
