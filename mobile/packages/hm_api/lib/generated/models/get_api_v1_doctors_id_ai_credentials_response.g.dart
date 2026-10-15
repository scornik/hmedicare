// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_doctors_id_ai_credentials_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1DoctorsIdAiCredentialsResponse
_$GetApiV1DoctorsIdAiCredentialsResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1DoctorsIdAiCredentialsResponse(
      data: AiCredentialList.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1DoctorsIdAiCredentialsResponseToJson(
  GetApiV1DoctorsIdAiCredentialsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
