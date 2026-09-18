// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_me_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1MeResponse _$GetApiV1MeResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1MeResponse(
      data: MeResponse.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1MeResponseToJson(GetApiV1MeResponse instance) =>
    <String, dynamic>{'data': instance.data, 'meta': instance.meta};
