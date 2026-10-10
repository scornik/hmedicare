// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_patients_id_communications_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1PatientsIdCommunicationsResponse
_$GetApiV1PatientsIdCommunicationsResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1PatientsIdCommunicationsResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => CommunicationSummary.fromJson(e as Map<String, dynamic>))
          .toList(),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1PatientsIdCommunicationsResponseToJson(
  GetApiV1PatientsIdCommunicationsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
