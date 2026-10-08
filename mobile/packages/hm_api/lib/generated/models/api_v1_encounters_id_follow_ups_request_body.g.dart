// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'api_v1_encounters_id_follow_ups_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApiV1EncountersIdFollowUpsRequestBody
_$ApiV1EncountersIdFollowUpsRequestBodyFromJson(Map<String, dynamic> json) =>
    ApiV1EncountersIdFollowUpsRequestBody(
      dueStartDate: json['dueStartDate'] as String,
      reason: json['reason'] as String,
      dueEndDate: json['dueEndDate'] as String?,
      instructions: json['instructions'] as String?,
    );

Map<String, dynamic> _$ApiV1EncountersIdFollowUpsRequestBodyToJson(
  ApiV1EncountersIdFollowUpsRequestBody instance,
) => <String, dynamic>{
  'dueEndDate': ?instance.dueEndDate,
  'dueStartDate': instance.dueStartDate,
  'instructions': ?instance.instructions,
  'reason': instance.reason,
};
