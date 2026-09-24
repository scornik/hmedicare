// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/get_api_v1_medications_search_response.dart';

part 'prescriptions_client.g.dart';

@RestApi()
abstract class PrescriptionsClient {
  factory PrescriptionsClient(Dio dio, {String? baseUrl}) = _PrescriptionsClient;

  /// Catalog lookup for the prescription editor. Matches normalized brand, Bangla brand, alias and generic keys and reports which tier produced each match. Inactive rows are excluded and veterinary products were never imported. This is a name lookup: it carries no dose, frequency or duration, and nothing it returns is clinical guidance.
  @GET('/api/v1/medications/search')
  Future<GetApiV1MedicationsSearchResponse> searchMedications({
    @Query('q') required String q,
    @Header('X-Tenant-ID') required String xTenantId,
    @Query('limit') int? limit,
  });
}
