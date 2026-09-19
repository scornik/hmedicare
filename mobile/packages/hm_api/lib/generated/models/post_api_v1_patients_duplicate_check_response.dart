// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'duplicate_check_response.dart';
import 'response_meta.dart';

part 'post_api_v1_patients_duplicate_check_response.g.dart';

@JsonSerializable()
class PostApiV1PatientsDuplicateCheckResponse {
  const PostApiV1PatientsDuplicateCheckResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1PatientsDuplicateCheckResponse.fromJson(Map<String, Object?> json) => _$PostApiV1PatientsDuplicateCheckResponseFromJson(json);
  
  final DuplicateCheckResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1PatientsDuplicateCheckResponseToJson(this);
}
