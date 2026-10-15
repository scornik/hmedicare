// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/approve_ai_suggestion_request.dart';
import '../models/change_ai_credential_request.dart';
import '../models/create_ai_credential_request.dart';
import '../models/create_ai_job_request.dart';
import '../models/get_api_v1_ai_acknowledgement_texts_response.dart';
import '../models/get_api_v1_ai_drafts_id_response.dart';
import '../models/get_api_v1_ai_jobs_id_response.dart';
import '../models/get_api_v1_ai_models_response.dart';
import '../models/get_api_v1_doctors_doctor_id_ai_usage_response.dart';
import '../models/get_api_v1_doctors_id_ai_acknowledgements_response.dart';
import '../models/get_api_v1_doctors_id_ai_credentials_response.dart';
import '../models/get_api_v1_encounters_id_ai_jobs_response.dart';
import '../models/get_api_v1_me_ai_credentials_response.dart';
import '../models/get_api_v1_tenant_ai_policy_events_response.dart';
import '../models/get_api_v1_tenant_ai_policy_response.dart';
import '../models/post_api_v1_ai_acknowledgements_id_withdraw_response.dart';
import '../models/post_api_v1_ai_acknowledgements_response.dart';
import '../models/post_api_v1_ai_drafts_id_close_response.dart';
import '../models/post_api_v1_ai_drafts_id_open_response.dart';
import '../models/post_api_v1_ai_jobs_id_cancel_response.dart';
import '../models/post_api_v1_ai_suggestions_id_approve_response.dart';
import '../models/post_api_v1_ai_suggestions_id_review_response.dart';
import '../models/post_api_v1_doctors_doctor_id_ai_credentials_id_actions_response.dart';
import '../models/post_api_v1_doctors_id_ai_credentials_response.dart';
import '../models/post_api_v1_encounters_id_ai_history_summary_response.dart';
import '../models/post_api_v1_encounters_id_ai_note_draft_response.dart';
import '../models/put_api_v1_tenant_ai_policy_response.dart';
import '../models/record_ai_acknowledgement_request.dart';
import '../models/review_ai_suggestion_request.dart';
import '../models/tenant_ai_policy_decision.dart';

part 'ai_client.g.dart';

@RestApi()
abstract class AiClient {
  factory AiClient(Dio dio, {String? baseUrl}) = _AiClient;

  /// The acknowledgement texts in force, with their hashes, for a screen that has to display one before a doctor agrees to it.
  @GET('/api/v1/ai/acknowledgement-texts')
  Future<GetApiV1AiAcknowledgementTextsResponse> listAiAcknowledgementTexts({
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// Records a doctor’s data-use acknowledgement of the current text. Idempotent for the same doctor, provider, tier and version.
  @POST('/api/v1/ai/acknowledgements')
  Future<PostApiV1AiAcknowledgementsResponse> recordAiAcknowledgement({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() RecordAiAcknowledgementRequest? body,
  });

  /// Withdraws an acknowledgement without deleting the record of it, and returns every credential that depended on it to PENDING_VALIDATION.
  @POST('/api/v1/ai/acknowledgements/{id}/withdraw')
  Future<PostApiV1AiAcknowledgementsIdWithdrawResponse> withdrawAiAcknowledgement({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
  });

  /// The draft with its suggestions and their source references. Readable by the encounter’s doctor or one covering for them.
  @GET('/api/v1/ai/drafts/{id}')
  Future<GetApiV1AiDraftsIdResponse> getAiDraft({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// Finishes review. Suggestions still pending stay pending: closing says the doctor is done looking, not that they rejected what they never read.
  @POST('/api/v1/ai/drafts/{id}/close')
  Future<PostApiV1AiDraftsIdCloseResponse> closeAiDraft({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
  });

  /// Marks the draft as being reviewed. Idempotent, and the first open time is kept.
  @POST('/api/v1/ai/drafts/{id}/open')
  Future<PostApiV1AiDraftsIdOpenResponse> openAiDraft({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
  });

  /// The job’s current state. Readable by the doctor who asked and by the encounter’s assigned doctor; nobody else learns that a draft was requested.
  @GET('/api/v1/ai/jobs/{id}')
  Future<GetApiV1AiJobsIdResponse> getAiJob({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// Requests cancellation. A queued or waiting job is cancelled outright; a running one is marked and the runner discards its result rather than claiming to have stopped a call already sent.
  @POST('/api/v1/ai/jobs/{id}/cancel')
  Future<PostApiV1AiJobsIdCancelResponse> cancelAiJob({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
  });

  /// Live models from the catalog, optionally for one provider. Deprecated models are omitted: a picker that still offered one would be offering a call the provider will refuse.
  @GET('/api/v1/ai/models')
  Future<GetApiV1AiModelsResponse> listAiModels({
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('providerCode') String? providerCode,
  });

  /// Streams the post-minimization request and the raw provider response for one job. Needs `ai.audit.raw_read`, and every read is audited before the bytes are opened. **Not a clinical record**: the response is the model’s unvalidated output, which may contain suggestions the validator discarded. Everything a doctor may act on is in the draft. Answers 404 where the tenant’s retention is zero, since nothing was kept.
  @GET('/api/v1/ai/raw-outputs/{jobId}')
  Future<void> readAiRawOutput({
    @Path('jobId') required String jobId,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// Puts an accepted or edited suggestion into the chart. Needs `ai.approve`, which the authorization matrix gives to doctors only, plus assignment to the encounter. The clinical write, the approval row and the suggestion’s status all commit together: an approval that landed separately from the record it created would leave one existing without the other.
  @POST('/api/v1/ai/suggestions/{id}/approve')
  Future<PostApiV1AiSuggestionsIdApproveResponse> approveAiSuggestion({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ApproveAiSuggestionRequest? body,
  });

  /// Records one decision. `expectedRowVersion` is required: two doctors covering for each other can both have the draft open, and a decision computed from a stale screen would overwrite one they cannot see. A closed or expired draft accepts no decisions.
  @POST('/api/v1/ai/suggestions/{id}/review')
  Future<PostApiV1AiSuggestionsIdReviewResponse> reviewAiSuggestion({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ReviewAiSuggestionRequest? body,
  });

  /// Disables, re-enables, requests revalidation of or revokes a credential. Revocation is terminal and replaces the stored secret with a tombstone, so the same key may later be added again.
  @POST('/api/v1/doctors/{doctorId}/ai/credentials/{id}/actions')
  Future<PostApiV1DoctorsDoctorIdAiCredentialsIdActionsResponse> changeAiCredential({
    @Path('doctorId') required String doctorId,
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() ChangeAiCredentialRequest? body,
  });

  /// Usage for a doctor’s own credentials. A doctor reads their own without any extra permission; reading a colleague’s needs `ai.usage.read`, because what they spent on their own key is theirs to know.
  @GET('/api/v1/doctors/{doctorId}/ai/usage')
  Future<GetApiV1DoctorsDoctorIdAiUsageResponse> getAiUsage({
    @Path('doctorId') required String doctorId,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// A doctor’s acknowledgements, including revoked ones, newest first.
  @GET('/api/v1/doctors/{id}/ai/acknowledgements')
  Future<GetApiV1DoctorsIdAiAcknowledgementsResponse> listAiAcknowledgements({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// A doctor’s AI credentials as safe metadata. No route returns the key itself.
  @GET('/api/v1/doctors/{id}/ai/credentials')
  Future<GetApiV1DoctorsIdAiCredentialsResponse> listAiCredentials({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// Stores a provider key for a doctor, sealed on arrival, as PENDING_VALIDATION. A doctor acts for themselves; anyone else needs ai.credentials.manage.
  @POST('/api/v1/doctors/{id}/ai/credentials')
  Future<PostApiV1DoctorsIdAiCredentialsResponse> createAiCredential({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() CreateAiCredentialRequest? body,
  });

  /// Queues a history-summary job for this encounter’s patient.
  @POST('/api/v1/encounters/{id}/ai/history-summary')
  Future<PostApiV1EncountersIdAiHistorySummaryResponse> createAiHistorySummaryJob({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() CreateAiJobRequest? body,
  });

  /// The latest 20 jobs for this encounter visible to the requester or their active doctor profile. Reading never queues work.
  @GET('/api/v1/encounters/{id}/ai/jobs')
  Future<GetApiV1EncountersIdAiJobsResponse> listEncounterAiJobs({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// Queues a note-draft job for this encounter. The response is the job, not the draft: the work happens in the worker, so a request never waits on a vendor.
  @POST('/api/v1/encounters/{id}/ai/note-draft')
  Future<PostApiV1EncountersIdAiNoteDraftResponse> createAiNoteDraftJob({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() CreateAiJobRequest? body,
  });

  /// Always answers FEATURE_DISABLED in MVP. The route exists so a client can tell "not built yet" from "not permitted": transcription would send raw audio, from which identifiers cannot be reliably removed (ADR-017 §3).
  @POST('/api/v1/encounters/{id}/ai/transcription')
  Future<void> createAiTranscriptionJob({
    @Path('id') required String id,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
  });

  /// Safe credential metadata belonging to the authenticated active doctor in the selected tenant.
  @GET('/api/v1/me/ai/credentials')
  Future<GetApiV1MeAiCredentialsResponse> listMyAiCredentials({
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// The tenant AI policy, or the defaults when it has never decided. Carries both the stored free-tier choice and the effective one.
  @GET('/api/v1/tenant/ai-policy')
  Future<GetApiV1TenantAiPolicyResponse> getTenantAiPolicy({
    @Header('X-Tenant-ID') required String xTenantId,
  });

  /// Records a policy decision and appends its hash-chained event. Tenant owners only (ai.policy.manage). A reason is required and is never defaulted.
  @PUT('/api/v1/tenant/ai-policy')
  Future<PutApiV1TenantAiPolicyResponse> decideTenantAiPolicy({
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() TenantAiPolicyDecision? body,
  });

  /// The decision history, newest first, as recorded on the verified chain.
  @GET('/api/v1/tenant/ai-policy/events')
  Future<GetApiV1TenantAiPolicyEventsResponse> listTenantAiPolicyEvents({
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('limit') int? limit,
  });
}
