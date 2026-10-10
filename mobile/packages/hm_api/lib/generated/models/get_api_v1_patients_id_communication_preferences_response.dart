// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'communication_preference_view.dart';
import 'response_meta.dart';

part 'get_api_v1_patients_id_communication_preferences_response.g.dart';

@JsonSerializable()
class GetApiV1PatientsIdCommunicationPreferencesResponse {
  const GetApiV1PatientsIdCommunicationPreferencesResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1PatientsIdCommunicationPreferencesResponse.fromJson(Map<String, Object?> json) => _$GetApiV1PatientsIdCommunicationPreferencesResponseFromJson(json);
  
  final List<CommunicationPreferenceView> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1PatientsIdCommunicationPreferencesResponseToJson(this);
}
