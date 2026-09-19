// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'merge_case.dart';

part 'merge_case_list_response.g.dart';

@JsonSerializable()
class MergeCaseListResponse {
  const MergeCaseListResponse({
    required this.hasMore,
    required this.items,
    required this.nextCursor,
  });
  
  factory MergeCaseListResponse.fromJson(Map<String, Object?> json) => _$MergeCaseListResponseFromJson(json);
  
  final bool hasMore;
  final List<MergeCase> items;
  final String? nextCursor;

  Map<String, Object?> toJson() => _$MergeCaseListResponseToJson(this);
}
