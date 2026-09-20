// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_chambers_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1ChambersResponse _$PostApiV1ChambersResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1ChambersResponse(
  data: Chamber.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1ChambersResponseToJson(
  PostApiV1ChambersResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
