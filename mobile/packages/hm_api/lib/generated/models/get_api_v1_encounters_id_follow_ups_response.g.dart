// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_encounters_id_follow_ups_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1EncountersIdFollowUpsResponse
_$GetApiV1EncountersIdFollowUpsResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1EncountersIdFollowUpsResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => FollowUpPlan.fromJson(e as Map<String, dynamic>))
          .toList(),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1EncountersIdFollowUpsResponseToJson(
  GetApiV1EncountersIdFollowUpsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
