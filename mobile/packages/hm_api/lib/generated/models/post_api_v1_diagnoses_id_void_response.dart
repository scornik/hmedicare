// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'diagnosis.dart';
import 'response_meta.dart';

part 'post_api_v1_diagnoses_id_void_response.g.dart';

@JsonSerializable()
class PostApiV1DiagnosesIdVoidResponse {
  const PostApiV1DiagnosesIdVoidResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1DiagnosesIdVoidResponse.fromJson(Map<String, Object?> json) => _$PostApiV1DiagnosesIdVoidResponseFromJson(json);
  
  final Diagnosis data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1DiagnosesIdVoidResponseToJson(this);
}
