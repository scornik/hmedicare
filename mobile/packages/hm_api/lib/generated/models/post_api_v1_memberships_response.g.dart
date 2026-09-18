// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_memberships_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1MembershipsResponse _$PostApiV1MembershipsResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1MembershipsResponse(
  data: Membership.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1MembershipsResponseToJson(
  PostApiV1MembershipsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
