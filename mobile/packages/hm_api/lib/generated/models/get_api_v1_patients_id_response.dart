// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient.dart';
import 'response_meta.dart';

part 'get_api_v1_patients_id_response.g.dart';

@JsonSerializable()
class GetApiV1PatientsIdResponse {
  const GetApiV1PatientsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1PatientsIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1PatientsIdResponseFromJson(json);
  
  final Patient data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1PatientsIdResponseToJson(this);
}
