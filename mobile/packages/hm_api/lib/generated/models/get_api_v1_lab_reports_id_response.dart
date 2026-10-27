// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data.dart';
import 'response_meta.dart';

part 'get_api_v1_lab_reports_id_response.g.dart';

@JsonSerializable()
class GetApiV1LabReportsIdResponse {
  const GetApiV1LabReportsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1LabReportsIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1LabReportsIdResponseFromJson(json);
  
  final Data data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1LabReportsIdResponseToJson(this);
}
