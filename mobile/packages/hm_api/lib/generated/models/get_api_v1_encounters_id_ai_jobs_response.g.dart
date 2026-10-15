// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_encounters_id_ai_jobs_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1EncountersIdAiJobsResponse _$GetApiV1EncountersIdAiJobsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1EncountersIdAiJobsResponse(
  data: AiJobList.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1EncountersIdAiJobsResponseToJson(
  GetApiV1EncountersIdAiJobsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
