// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'merge_case_list_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MergeCaseListResponse _$MergeCaseListResponseFromJson(
  Map<String, dynamic> json,
) => MergeCaseListResponse(
  hasMore: json['hasMore'] as bool,
  items: (json['items'] as List<dynamic>)
      .map((e) => MergeCase.fromJson(e as Map<String, dynamic>))
      .toList(),
  nextCursor: json['nextCursor'] as String?,
);

Map<String, dynamic> _$MergeCaseListResponseToJson(
  MergeCaseListResponse instance,
) => <String, dynamic>{
  'hasMore': instance.hasMore,
  'items': instance.items,
  'nextCursor': ?instance.nextCursor,
};
