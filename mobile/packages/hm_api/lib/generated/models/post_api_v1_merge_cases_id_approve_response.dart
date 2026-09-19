// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'merge_case.dart';
import 'response_meta.dart';

part 'post_api_v1_merge_cases_id_approve_response.g.dart';

@JsonSerializable()
class PostApiV1MergeCasesIdApproveResponse {
  const PostApiV1MergeCasesIdApproveResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1MergeCasesIdApproveResponse.fromJson(Map<String, Object?> json) => _$PostApiV1MergeCasesIdApproveResponseFromJson(json);
  
  final MergeCase data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1MergeCasesIdApproveResponseToJson(this);
}
