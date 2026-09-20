// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patch_api_v1_clinics_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatchApiV1ClinicsIdResponse _$PatchApiV1ClinicsIdResponseFromJson(
  Map<String, dynamic> json,
) => PatchApiV1ClinicsIdResponse(
  data: Clinic.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PatchApiV1ClinicsIdResponseToJson(
  PatchApiV1ClinicsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
