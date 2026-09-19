// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient.dart';
import 'response_meta.dart';

part 'post_api_v1_patients_response.g.dart';

@JsonSerializable()
class PostApiV1PatientsResponse {
  const PostApiV1PatientsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1PatientsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1PatientsResponseFromJson(json);
  
  final Patient data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1PatientsResponseToJson(this);
}
