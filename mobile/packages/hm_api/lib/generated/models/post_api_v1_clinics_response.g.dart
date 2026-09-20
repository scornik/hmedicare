// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_clinics_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1ClinicsResponse _$PostApiV1ClinicsResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1ClinicsResponse(
  data: Clinic.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1ClinicsResponseToJson(
  PostApiV1ClinicsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
