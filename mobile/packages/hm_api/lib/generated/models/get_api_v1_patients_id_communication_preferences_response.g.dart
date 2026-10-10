// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_patients_id_communication_preferences_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1PatientsIdCommunicationPreferencesResponse
_$GetApiV1PatientsIdCommunicationPreferencesResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1PatientsIdCommunicationPreferencesResponse(
  data: (json['data'] as List<dynamic>)
      .map(
        (e) => CommunicationPreferenceView.fromJson(e as Map<String, dynamic>),
      )
      .toList(),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1PatientsIdCommunicationPreferencesResponseToJson(
  GetApiV1PatientsIdCommunicationPreferencesResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
