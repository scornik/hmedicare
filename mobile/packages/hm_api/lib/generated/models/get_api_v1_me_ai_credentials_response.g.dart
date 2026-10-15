// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_me_ai_credentials_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1MeAiCredentialsResponse _$GetApiV1MeAiCredentialsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1MeAiCredentialsResponse(
  data: AiCredentialList.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1MeAiCredentialsResponseToJson(
  GetApiV1MeAiCredentialsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
