// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_credential_list.dart';
import 'response_meta.dart';

part 'get_api_v1_doctors_id_ai_credentials_response.g.dart';

@JsonSerializable()
class GetApiV1DoctorsIdAiCredentialsResponse {
  const GetApiV1DoctorsIdAiCredentialsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1DoctorsIdAiCredentialsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1DoctorsIdAiCredentialsResponseFromJson(json);
  
  final AiCredentialList data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1DoctorsIdAiCredentialsResponseToJson(this);
}
