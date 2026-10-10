// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/api_v1_patients_id_communication_preferences_request_body.dart';
import '../models/api_v1_webhooks_communication_provider_adapter_request_body.dart';
import '../models/communication_webhook_adapter.dart';
import '../models/get_api_v1_communication_links_token_response.dart';
import '../models/get_api_v1_patients_id_communication_preferences_response.dart';
import '../models/get_api_v1_patients_id_communications_response.dart';
import '../models/post_api_v1_webhooks_communication_provider_adapter_response.dart';
import '../models/put_api_v1_patients_id_communication_preferences_response.dart';

part 'communication_client.g.dart';

@RestApi()
abstract class CommunicationClient {
  factory CommunicationClient(Dio dio, {String? baseUrl}) = _CommunicationClient;

  @GET('/api/v1/communication-links/{token}')
  Future<GetApiV1CommunicationLinksTokenResponse> resolveCommunicationLink({
    @Path('token') required String token,
    @Header('X-Tenant-ID') required String xTenantId,
    @Header('X-Patient-Context') required String xPatientContext,
  });

  @GET('/api/v1/patients/{id}/communication-preferences')
  Future<GetApiV1PatientsIdCommunicationPreferencesResponse> listCommunicationPreferences({
    @Path('id') required String id,
    @Header('X-Tenant-ID') String? xTenantId,
    @Header('X-Patient-Context') String? xPatientContext,
    @Header('Idempotency-Key') String? idempotencyKey,
  });

  @PUT('/api/v1/patients/{id}/communication-preferences')
  Future<PutApiV1PatientsIdCommunicationPreferencesResponse> setCommunicationPreference({
    @Path('id') required String id,
    @Header('X-Tenant-ID') String? xTenantId,
    @Header('X-Patient-Context') String? xPatientContext,
    @Header('Idempotency-Key') String? idempotencyKey,
    @Body() ApiV1PatientsIdCommunicationPreferencesRequestBody? body,
  });

  @GET('/api/v1/patients/{id}/communications')
  Future<GetApiV1PatientsIdCommunicationsResponse> listPatientCommunications({
    @Path('id') required String id,
    @Header('X-Tenant-ID') String? xTenantId,
    @Header('X-Patient-Context') String? xPatientContext,
    @Header('Idempotency-Key') String? idempotencyKey,
  });

  @POST('/api/v1/webhooks/communication/{providerAdapter}')
  Future<PostApiV1WebhooksCommunicationProviderAdapterResponse> receiveCommunicationWebhook({
    @Path('providerAdapter') required CommunicationWebhookAdapter providerAdapter,
    @Header('x-mock-signature') required String xMockSignature,
    @Body() ApiV1WebhooksCommunicationProviderAdapterRequestBody? body,
  });
}
