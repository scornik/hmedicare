// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_chambers_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1ChambersIdResponse _$GetApiV1ChambersIdResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1ChambersIdResponse(
  data: Chamber.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1ChambersIdResponseToJson(
  GetApiV1ChambersIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
