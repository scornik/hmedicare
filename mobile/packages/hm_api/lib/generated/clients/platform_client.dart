// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/bootstrap_tenant_request.dart';
import '../models/get_api_v1_admin_medications_gates_dataset_version_response.dart';
import '../models/get_api_v1_admin_medications_imports_id_response.dart';
import '../models/get_api_v1_admin_medications_imports_response.dart';
import '../models/post_api_v1_admin_medications_gates_response.dart';
import '../models/post_api_v1_admin_medications_imports_response.dart';
import '../models/post_api_v1_tenants_response.dart';
import '../models/record_medication_gate_request.dart';
import '../models/request_medication_import_request.dart';
import '../models/x_platform_context.dart';

part 'platform_client.g.dart';

@RestApi()
abstract class PlatformClient {
  factory PlatformClient(Dio dio, {String? baseUrl}) = _PlatformClient;

  /// Records one dataset-card gate attestation. Append-only and hash-chained: there is no update and no delete, because the value of an attestation is that it cannot be quietly changed afterwards. Platform operators only.
  @POST('/api/v1/admin/medications/gates')
  Future<PostApiV1AdminMedicationsGatesResponse> recordMedicationGate({
    @Header('X-Platform-Context') required XPlatformContext xPlatformContext,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() RecordMedicationGateRequest? body,
  });

  /// Which of the four gates a version has and which it is missing. Platform operators only.
  @GET('/api/v1/admin/medications/gates/{datasetVersion}')
  Future<GetApiV1AdminMedicationsGatesDatasetVersionResponse> getMedicationGateStatus({
    @Path('datasetVersion') required String datasetVersion,
    @Header('X-Platform-Context') required XPlatformContext xPlatformContext,
  });

  /// The most recent imports, newest first. Platform operators only.
  @GET('/api/v1/admin/medications/imports')
  Future<GetApiV1AdminMedicationsImportsResponse> listMedicationImports({
    @Header('X-Platform-Context') required XPlatformContext xPlatformContext,
    @Query('limit') int? limit,
  });

  /// Queues an import of an already-staged dataset. Platform operators only (X-Platform-Context: operator, medication.import). In production the import is refused unless MEDICATION_IMPORT_PRODUCTION_ALLOWED is true and all four dataset-card gates are attested for that version; the refusal is recorded as an import row naming the missing gates.
  @POST('/api/v1/admin/medications/imports')
  Future<PostApiV1AdminMedicationsImportsResponse> requestMedicationImport({
    @Header('X-Platform-Context') required XPlatformContext xPlatformContext,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() RequestMedicationImportRequest? body,
  });

  /// One import, including its counts and its resume checkpoint. Platform operators only.
  @GET('/api/v1/admin/medications/imports/{id}')
  Future<GetApiV1AdminMedicationsImportsIdResponse> getMedicationImport({
    @Path('id') required String id,
    @Header('X-Platform-Context') required XPlatformContext xPlatformContext,
  });

  /// Platform operators only (X-Platform-Context: operator, platform.tenants.bootstrap).
  @POST('/api/v1/tenants')
  Future<PostApiV1TenantsResponse> bootstrapTenant({
    @Header('X-Platform-Context') required XPlatformContext xPlatformContext,
    @Header('Idempotency-Key') required String idempotencyKey,
    @Body() BootstrapTenantRequest? body,
  });
}
