// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patch_api_v1_follow_ups_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatchApiV1FollowUpsIdResponse _$PatchApiV1FollowUpsIdResponseFromJson(
  Map<String, dynamic> json,
) => PatchApiV1FollowUpsIdResponse(
  data: FollowUpPlan.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PatchApiV1FollowUpsIdResponseToJson(
  PatchApiV1FollowUpsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
