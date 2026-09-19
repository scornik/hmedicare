// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_patients_id_consents_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PatientsIdConsentsResponse
_$PostApiV1PatientsIdConsentsResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1PatientsIdConsentsResponse(
      data: Consent.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1PatientsIdConsentsResponseToJson(
  PostApiV1PatientsIdConsentsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
