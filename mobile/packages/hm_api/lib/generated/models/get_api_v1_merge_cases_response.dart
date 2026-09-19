// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'merge_case_list_response.dart';
import 'response_meta.dart';

part 'get_api_v1_merge_cases_response.g.dart';

@JsonSerializable()
class GetApiV1MergeCasesResponse {
  const GetApiV1MergeCasesResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1MergeCasesResponse.fromJson(Map<String, Object?> json) => _$GetApiV1MergeCasesResponseFromJson(json);
  
  final MergeCaseListResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1MergeCasesResponseToJson(this);
}
