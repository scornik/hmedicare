// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_credential.dart';
import 'response_meta.dart';

part 'post_api_v1_doctors_id_ai_credentials_response.g.dart';

@JsonSerializable()
class PostApiV1DoctorsIdAiCredentialsResponse {
  const PostApiV1DoctorsIdAiCredentialsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1DoctorsIdAiCredentialsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1DoctorsIdAiCredentialsResponseFromJson(json);
  
  final AiCredential data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1DoctorsIdAiCredentialsResponseToJson(this);
}
