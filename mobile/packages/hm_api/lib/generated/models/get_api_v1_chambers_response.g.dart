// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_chambers_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1ChambersResponse _$GetApiV1ChambersResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1ChambersResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => Chamber.fromJson(e as Map<String, dynamic>))
      .toList(),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1ChambersResponseToJson(
  GetApiV1ChambersResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
