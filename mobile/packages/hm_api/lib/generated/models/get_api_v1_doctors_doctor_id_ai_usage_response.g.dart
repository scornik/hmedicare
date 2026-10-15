// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_doctors_doctor_id_ai_usage_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1DoctorsDoctorIdAiUsageResponse
_$GetApiV1DoctorsDoctorIdAiUsageResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1DoctorsDoctorIdAiUsageResponse(
      data: AiCredentialUsageList.fromJson(
        json['data'] as Map<String, dynamic>,
      ),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1DoctorsDoctorIdAiUsageResponseToJson(
  GetApiV1DoctorsDoctorIdAiUsageResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
