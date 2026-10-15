// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'my_ai_credential_list.dart';
import 'response_meta.dart';

part 'get_api_v1_me_ai_credentials_response.g.dart';

@JsonSerializable()
class GetApiV1MeAiCredentialsResponse {
  const GetApiV1MeAiCredentialsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1MeAiCredentialsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1MeAiCredentialsResponseFromJson(json);
  
  final MyAiCredentialList data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1MeAiCredentialsResponseToJson(this);
}
