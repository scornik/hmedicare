// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_credential_usage_list.dart';
import 'response_meta.dart';

part 'get_api_v1_doctors_doctor_id_ai_usage_response.g.dart';

@JsonSerializable()
class GetApiV1DoctorsDoctorIdAiUsageResponse {
  const GetApiV1DoctorsDoctorIdAiUsageResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1DoctorsDoctorIdAiUsageResponse.fromJson(Map<String, Object?> json) => _$GetApiV1DoctorsDoctorIdAiUsageResponseFromJson(json);
  
  final AiCredentialUsageList data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1DoctorsDoctorIdAiUsageResponseToJson(this);
}
