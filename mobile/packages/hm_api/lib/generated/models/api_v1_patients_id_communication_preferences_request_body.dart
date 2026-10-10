// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'communication_channel.dart';
import 'communication_preference_value.dart';

part 'api_v1_patients_id_communication_preferences_request_body.g.dart';

@JsonSerializable()
class ApiV1PatientsIdCommunicationPreferencesRequestBody {
  const ApiV1PatientsIdCommunicationPreferencesRequestBody({
    required this.channel,
    required this.consentVersion,
    required this.preference,
    this.contactId,
  });
  
  factory ApiV1PatientsIdCommunicationPreferencesRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1PatientsIdCommunicationPreferencesRequestBodyFromJson(json);
  
  final CommunicationChannel channel;
  final int consentVersion;
  final String? contactId;
  final CommunicationPreferenceValue preference;

  Map<String, Object?> toJson() => _$ApiV1PatientsIdCommunicationPreferencesRequestBodyToJson(this);
}
