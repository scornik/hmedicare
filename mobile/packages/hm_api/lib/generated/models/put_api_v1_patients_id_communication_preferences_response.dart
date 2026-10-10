// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'communication_preference_view.dart';
import 'response_meta.dart';

part 'put_api_v1_patients_id_communication_preferences_response.g.dart';

@JsonSerializable()
class PutApiV1PatientsIdCommunicationPreferencesResponse {
  const PutApiV1PatientsIdCommunicationPreferencesResponse({
    required this.data,
    required this.meta,
  });
  
  factory PutApiV1PatientsIdCommunicationPreferencesResponse.fromJson(Map<String, Object?> json) => _$PutApiV1PatientsIdCommunicationPreferencesResponseFromJson(json);
  
  final CommunicationPreferenceView data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PutApiV1PatientsIdCommunicationPreferencesResponseToJson(this);
}
