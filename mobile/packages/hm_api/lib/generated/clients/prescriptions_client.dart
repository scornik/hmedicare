// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/approve_prescription_request.dart';
import '../models/edit_prescription_request.dart';
import '../models/get_api_v1_encounters_id_prescriptions_response.dart';
import '../models/get_api_v1_medications_search_response.dart';
import '../models/get_api_v1_prescriptions_id_response.dart';
import '../models/patch_api_v1_prescriptions_id_response.dart';
import '../models/post_api_v1_encounters_id_prescriptions_response.dart';
import '../models/post_api_v1_prescriptions_id_approve_response.dart';
import '../models/post_api_v1_prescriptions_id_corrections_response.dart';
import '../models/post_api_v1_prescriptions_id_review_response.dart';
import '../models/post_api_v1_prescriptions_id_void_response.dart';
import '../models/prescription_row_version_only.dart';
import '../models/void_prescription_request.dart';

part 'prescriptions_client.g.dart';

@RestApi()
abstract class PrescriptionsClient {
  factory PrescriptionsClient(Dio dio, {String? baseUrl}) = _PrescriptionsClient;

  /// Every revision for the encounter, newest first — the history a correction leaves behind.
  @GET('/api/v1/encounters/{id}/prescriptions')
  Future<GetApiV1EncountersIdPrescriptionsResponse> listEncounterPrescriptions({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// The encounter's open draft, created on first use. Assignment only: a prescription carries the prescribing doctor's name, so it cannot be brought into being by someone the encounter does not assign.
  @POST('/api/v1/encounters/{id}/prescriptions')
  Future<PostApiV1EncountersIdPrescriptionsResponse> createPrescriptionDraft({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
  });

  /// Catalog lookup for the prescription editor. Matches normalized brand, Bangla brand, alias and generic keys and reports which tier produced each match. Inactive rows are excluded and veterinary products were never imported. This is a name lookup: it carries no dose, frequency or duration, and nothing it returns is clinical guidance.
  @GET('/api/v1/medications/search')
  Future<GetApiV1MedicationsSearchResponse> searchMedications({
    @Query('q') required String q,
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('limit') int? limit,
  });

  @GET('/api/v1/prescriptions/{id}')
  Future<GetApiV1PrescriptionsIdResponse> getPrescription({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// Replaces the item list. Editing a REVIEWED prescription returns it to DRAFT, because "someone checked these items" stops being true once the items change. APPROVED is refused.
  @PATCH('/api/v1/prescriptions/{id}')
  Future<PatchApiV1PrescriptionsIdResponse> editPrescriptionDraft({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Body() EditPrescriptionRequest? body,
  });

  /// Final clinical truth, frozen under a content hash. Assigned doctor only. Where this revision supersedes another, the superseded one is voided in the same transaction.
  @POST('/api/v1/prescriptions/{id}/approve')
  Future<PostApiV1PrescriptionsIdApproveResponse> approvePrescription({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ApprovePrescriptionRequest? body,
  });

  /// Starts revision N+1 carrying a copy of the approved items. The approved revision is untouched until the correction is itself approved, so an abandoned correction changes nothing.
  @POST('/api/v1/prescriptions/{id}/corrections')
  Future<PostApiV1PrescriptionsIdCorrectionsResponse> createPrescriptionCorrection({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
  });

  /// An optional "items checked" marker with no clinical effect: not final, not visible to patients and not renderable. A nurse holding prescription.review may set it.
  @POST('/api/v1/prescriptions/{id}/review')
  Future<PostApiV1PrescriptionsIdReviewResponse> markPrescriptionReviewed({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() PrescriptionRowVersionOnly? body,
  });

  /// Withdraws an approved prescription with a reason. There is no path back.
  @POST('/api/v1/prescriptions/{id}/void')
  Future<PostApiV1PrescriptionsIdVoidResponse> voidPrescription({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() VoidPrescriptionRequest? body,
  });
}
