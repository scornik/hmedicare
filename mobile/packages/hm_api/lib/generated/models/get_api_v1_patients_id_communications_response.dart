// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'communication_summary.dart';
import 'response_meta.dart';

part 'get_api_v1_patients_id_communications_response.g.dart';

@JsonSerializable()
class GetApiV1PatientsIdCommunicationsResponse {
  const GetApiV1PatientsIdCommunicationsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1PatientsIdCommunicationsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1PatientsIdCommunicationsResponseFromJson(json);
  
  final List<CommunicationSummary> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1PatientsIdCommunicationsResponseToJson(this);
}
