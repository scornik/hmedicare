// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_ai_jobs_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1AiJobsIdResponse _$GetApiV1AiJobsIdResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1AiJobsIdResponse(
  data: AiJob.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1AiJobsIdResponseToJson(
  GetApiV1AiJobsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
