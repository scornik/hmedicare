// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/add_care_team_member_request.dart';
import '../models/api_v1_care_team_members_id_end_request_body.dart';
import '../models/get_api_v1_patients_id_care_team_response.dart';
import '../models/post_api_v1_care_team_members_id_end_response.dart';
import '../models/post_api_v1_patients_id_care_team_response.dart';

part 'care_team_client.g.dart';

@RestApi()
abstract class CareTeamClient {
  factory CareTeamClient(Dio dio, {String? baseUrl}) = _CareTeamClient;

  @POST('/api/v1/care-team-members/{id}/end')
  Future<PostApiV1CareTeamMembersIdEndResponse> endCareTeamMember({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ApiV1CareTeamMembersIdEndRequestBody? body,
  });

  @GET('/api/v1/patients/{id}/care-team')
  Future<GetApiV1PatientsIdCareTeamResponse> listCareTeam({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/patients/{id}/care-team')
  Future<PostApiV1PatientsIdCareTeamResponse> addCareTeamMember({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() AddCareTeamMemberRequest? body,
  });
}
