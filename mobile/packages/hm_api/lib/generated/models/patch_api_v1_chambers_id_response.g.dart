// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patch_api_v1_chambers_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatchApiV1ChambersIdResponse _$PatchApiV1ChambersIdResponseFromJson(
  Map<String, dynamic> json,
) => PatchApiV1ChambersIdResponse(
  data: Chamber.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PatchApiV1ChambersIdResponseToJson(
  PatchApiV1ChambersIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
