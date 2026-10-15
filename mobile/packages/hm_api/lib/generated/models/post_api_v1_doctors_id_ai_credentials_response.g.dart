// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_doctors_id_ai_credentials_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1DoctorsIdAiCredentialsResponse
_$PostApiV1DoctorsIdAiCredentialsResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1DoctorsIdAiCredentialsResponse(
      data: AiCredential.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1DoctorsIdAiCredentialsResponseToJson(
  PostApiV1DoctorsIdAiCredentialsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
