// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'api_v1_follow_ups_id_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApiV1FollowUpsIdRequestBody _$ApiV1FollowUpsIdRequestBodyFromJson(
  Map<String, dynamic> json,
) => ApiV1FollowUpsIdRequestBody(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  dueEndDate: json['dueEndDate'] as String?,
  dueStartDate: json['dueStartDate'] as String?,
  instructions: json['instructions'] as String?,
  reason: json['reason'] as String?,
  status: json['status'] == null
      ? null
      : FollowUpTerminalStatus.fromJson(json['status'] as String),
);

Map<String, dynamic> _$ApiV1FollowUpsIdRequestBodyToJson(
  ApiV1FollowUpsIdRequestBody instance,
) => <String, dynamic>{
  'dueEndDate': ?instance.dueEndDate,
  'dueStartDate': ?instance.dueStartDate,
  'expectedRowVersion': instance.expectedRowVersion,
  'instructions': ?instance.instructions,
  'reason': ?instance.reason,
  'status': ?instance.status,
};
