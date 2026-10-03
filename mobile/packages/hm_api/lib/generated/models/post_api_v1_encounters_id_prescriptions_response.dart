// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'prescription.dart';
import 'response_meta.dart';

part 'post_api_v1_encounters_id_prescriptions_response.g.dart';

@JsonSerializable()
class PostApiV1EncountersIdPrescriptionsResponse {
  const PostApiV1EncountersIdPrescriptionsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1EncountersIdPrescriptionsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1EncountersIdPrescriptionsResponseFromJson(json);
  
  final Prescription data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1EncountersIdPrescriptionsResponseToJson(this);
}
