// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'medication_search_results.dart';
import 'response_meta.dart';

part 'get_api_v1_medications_search_response.g.dart';

@JsonSerializable()
class GetApiV1MedicationsSearchResponse {
  const GetApiV1MedicationsSearchResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1MedicationsSearchResponse.fromJson(Map<String, Object?> json) => _$GetApiV1MedicationsSearchResponseFromJson(json);
  
  final MedicationSearchResults data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1MedicationsSearchResponseToJson(this);
}
