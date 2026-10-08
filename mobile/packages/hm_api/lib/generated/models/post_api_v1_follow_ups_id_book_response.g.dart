// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_follow_ups_id_book_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1FollowUpsIdBookResponse _$PostApiV1FollowUpsIdBookResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1FollowUpsIdBookResponse(
  data: Appointment.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1FollowUpsIdBookResponseToJson(
  PostApiV1FollowUpsIdBookResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
