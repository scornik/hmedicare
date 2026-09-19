// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_merge_cases_id_approve_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1MergeCasesIdApproveResponse
_$PostApiV1MergeCasesIdApproveResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1MergeCasesIdApproveResponse(
      data: MergeCase.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1MergeCasesIdApproveResponseToJson(
  PostApiV1MergeCasesIdApproveResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
