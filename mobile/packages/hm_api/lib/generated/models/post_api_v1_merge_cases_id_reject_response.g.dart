// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_merge_cases_id_reject_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1MergeCasesIdRejectResponse
_$PostApiV1MergeCasesIdRejectResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1MergeCasesIdRejectResponse(
      data: MergeCase.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1MergeCasesIdRejectResponseToJson(
  PostApiV1MergeCasesIdRejectResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
