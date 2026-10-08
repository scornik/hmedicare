// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'api_v1_follow_ups_id_book_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApiV1FollowUpsIdBookRequestBody _$ApiV1FollowUpsIdBookRequestBodyFromJson(
  Map<String, dynamic> json,
) => ApiV1FollowUpsIdBookRequestBody(
  careMode: CareMode.fromJson(json['careMode'] as String),
  chamberId: json['chamberId'] as String,
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  localDate: json['localDate'] as String,
  slotId: json['slotId'] as String?,
);

Map<String, dynamic> _$ApiV1FollowUpsIdBookRequestBodyToJson(
  ApiV1FollowUpsIdBookRequestBody instance,
) => <String, dynamic>{
  'careMode': instance.careMode,
  'chamberId': instance.chamberId,
  'expectedRowVersion': instance.expectedRowVersion,
  'localDate': instance.localDate,
  'slotId': ?instance.slotId,
};
