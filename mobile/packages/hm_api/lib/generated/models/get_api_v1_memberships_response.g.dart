// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_memberships_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1MembershipsResponse _$GetApiV1MembershipsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1MembershipsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => Membership.fromJson(e as Map<String, dynamic>))
      .toList(),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1MembershipsResponseToJson(
  GetApiV1MembershipsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
