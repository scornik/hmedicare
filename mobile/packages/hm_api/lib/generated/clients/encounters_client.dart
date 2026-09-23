// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/api_v1_encounters_id_complete_request_body.dart';
import '../models/api_v1_encounters_id_resume_request_body.dart';
import '../models/enter_encounter_in_error_request.dart';
import '../models/get_api_v1_encounters_id_response.dart';
import '../models/interrupt_encounter_request.dart';
import '../models/post_api_v1_encounters_id_complete_response.dart';
import '../models/post_api_v1_encounters_id_entered_in_error_response.dart';
import '../models/post_api_v1_encounters_id_interrupt_response.dart';
import '../models/post_api_v1_encounters_id_resume_response.dart';
import '../models/post_api_v1_serials_id_encounter_response.dart';
import '../models/start_encounter_request.dart';

part 'encounters_client.g.dart';

@RestApi()
abstract class EncountersClient {
  factory EncountersClient(Dio dio, {String? baseUrl}) = _EncountersClient;

  @GET('/api/v1/encounters/{id}')
  Future<GetApiV1EncountersIdResponse> getEncounter({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  @POST('/api/v1/encounters/{id}/complete')
  Future<PostApiV1EncountersIdCompleteResponse> completeEncounter({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ApiV1EncountersIdCompleteRequestBody? body,
  });

  @POST('/api/v1/encounters/{id}/entered-in-error')
  Future<PostApiV1EncountersIdEnteredInErrorResponse> enterEncounterInError({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() EnterEncounterInErrorRequest? body,
  });

  @POST('/api/v1/encounters/{id}/interrupt')
  Future<PostApiV1EncountersIdInterruptResponse> interruptEncounter({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() InterruptEncounterRequest? body,
  });

  @POST('/api/v1/encounters/{id}/resume')
  Future<PostApiV1EncountersIdResumeResponse> resumeEncounter({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ApiV1EncountersIdResumeRequestBody? body,
  });

  @POST('/api/v1/serials/{id}/encounter')
  Future<PostApiV1SerialsIdEncounterResponse> startEncounter({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() StartEncounterRequest? body,
  });
}
