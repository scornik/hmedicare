// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_patients_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PatientsResponse _$PostApiV1PatientsResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1PatientsResponse(
  data: Patient.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1PatientsResponseToJson(
  PostApiV1PatientsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
