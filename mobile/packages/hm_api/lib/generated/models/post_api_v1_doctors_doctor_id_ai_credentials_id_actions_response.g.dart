// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_doctors_doctor_id_ai_credentials_id_actions_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1DoctorsDoctorIdAiCredentialsIdActionsResponse
_$PostApiV1DoctorsDoctorIdAiCredentialsIdActionsResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1DoctorsDoctorIdAiCredentialsIdActionsResponse(
  data: AiCredential.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic>
_$PostApiV1DoctorsDoctorIdAiCredentialsIdActionsResponseToJson(
  PostApiV1DoctorsDoctorIdAiCredentialsIdActionsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
