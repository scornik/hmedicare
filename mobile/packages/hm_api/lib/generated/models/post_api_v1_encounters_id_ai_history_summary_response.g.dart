// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_encounters_id_ai_history_summary_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1EncountersIdAiHistorySummaryResponse
_$PostApiV1EncountersIdAiHistorySummaryResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1EncountersIdAiHistorySummaryResponse(
  data: AiJob.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1EncountersIdAiHistorySummaryResponseToJson(
  PostApiV1EncountersIdAiHistorySummaryResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
