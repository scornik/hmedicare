// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_clinics_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1ClinicsResponse _$GetApiV1ClinicsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1ClinicsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => Clinic.fromJson(e as Map<String, dynamic>))
      .toList(),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1ClinicsResponseToJson(
  GetApiV1ClinicsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
