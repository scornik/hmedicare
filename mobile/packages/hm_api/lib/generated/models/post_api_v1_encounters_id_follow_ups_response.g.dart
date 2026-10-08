// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_encounters_id_follow_ups_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1EncountersIdFollowUpsResponse
_$PostApiV1EncountersIdFollowUpsResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1EncountersIdFollowUpsResponse(
      data: FollowUpPlan.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1EncountersIdFollowUpsResponseToJson(
  PostApiV1EncountersIdFollowUpsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
