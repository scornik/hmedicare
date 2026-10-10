// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'api_v1_patients_id_communication_preferences_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApiV1PatientsIdCommunicationPreferencesRequestBody
_$ApiV1PatientsIdCommunicationPreferencesRequestBodyFromJson(
  Map<String, dynamic> json,
) => ApiV1PatientsIdCommunicationPreferencesRequestBody(
  channel: CommunicationChannel.fromJson(json['channel'] as String),
  consentVersion: (json['consentVersion'] as num).toInt(),
  preference: CommunicationPreferenceValue.fromJson(
    json['preference'] as String,
  ),
  contactId: json['contactId'] as String?,
);

Map<String, dynamic> _$ApiV1PatientsIdCommunicationPreferencesRequestBodyToJson(
  ApiV1PatientsIdCommunicationPreferencesRequestBody instance,
) => <String, dynamic>{
  'channel': instance.channel,
  'consentVersion': instance.consentVersion,
  'contactId': ?instance.contactId,
  'preference': instance.preference,
};
