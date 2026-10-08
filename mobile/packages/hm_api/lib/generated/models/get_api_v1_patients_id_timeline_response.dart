// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'timeline_page.dart';
import 'response_meta.dart';

part 'get_api_v1_patients_id_timeline_response.g.dart';

@JsonSerializable()
class GetApiV1PatientsIdTimelineResponse {
  const GetApiV1PatientsIdTimelineResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1PatientsIdTimelineResponse.fromJson(Map<String, Object?> json) => _$GetApiV1PatientsIdTimelineResponseFromJson(json);
  
  final TimelinePage data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1PatientsIdTimelineResponseToJson(this);
}
