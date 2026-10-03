// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'prescription_list.dart';
import 'response_meta.dart';

part 'get_api_v1_encounters_id_prescriptions_response.g.dart';

@JsonSerializable()
class GetApiV1EncountersIdPrescriptionsResponse {
  const GetApiV1EncountersIdPrescriptionsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1EncountersIdPrescriptionsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1EncountersIdPrescriptionsResponseFromJson(json);
  
  final PrescriptionList data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1EncountersIdPrescriptionsResponseToJson(this);
}
