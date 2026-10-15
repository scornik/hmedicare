// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_ai_jobs_id_cancel_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AiJobsIdCancelResponse _$PostApiV1AiJobsIdCancelResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1AiJobsIdCancelResponse(
  data: AiJob.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1AiJobsIdCancelResponseToJson(
  PostApiV1AiJobsIdCancelResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
