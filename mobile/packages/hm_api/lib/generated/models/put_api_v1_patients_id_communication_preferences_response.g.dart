// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'put_api_v1_patients_id_communication_preferences_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PutApiV1PatientsIdCommunicationPreferencesResponse
_$PutApiV1PatientsIdCommunicationPreferencesResponseFromJson(
  Map<String, dynamic> json,
) => PutApiV1PatientsIdCommunicationPreferencesResponse(
  data: CommunicationPreferenceView.fromJson(
    json['data'] as Map<String, dynamic>,
  ),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PutApiV1PatientsIdCommunicationPreferencesResponseToJson(
  PutApiV1PatientsIdCommunicationPreferencesResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
