// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_me_patient_contexts_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1MePatientContextsResponse _$GetApiV1MePatientContextsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1MePatientContextsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => PatientContext.fromJson(e as Map<String, dynamic>))
      .toList(),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1MePatientContextsResponseToJson(
  GetApiV1MePatientContextsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
