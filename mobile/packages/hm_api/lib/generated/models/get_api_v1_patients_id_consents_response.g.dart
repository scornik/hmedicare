// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_patients_id_consents_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1PatientsIdConsentsResponse _$GetApiV1PatientsIdConsentsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1PatientsIdConsentsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => Consent.fromJson(e as Map<String, dynamic>))
      .toList(),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1PatientsIdConsentsResponseToJson(
  GetApiV1PatientsIdConsentsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
