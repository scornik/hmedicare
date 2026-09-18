// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patch_api_v1_memberships_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatchApiV1MembershipsIdResponse _$PatchApiV1MembershipsIdResponseFromJson(
  Map<String, dynamic> json,
) => PatchApiV1MembershipsIdResponse(
  data: Membership.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PatchApiV1MembershipsIdResponseToJson(
  PatchApiV1MembershipsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
