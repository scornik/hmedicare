// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_patients_id_timeline_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1PatientsIdTimelineResponse _$GetApiV1PatientsIdTimelineResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1PatientsIdTimelineResponse(
  data: TimelinePage.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1PatientsIdTimelineResponseToJson(
  GetApiV1PatientsIdTimelineResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
