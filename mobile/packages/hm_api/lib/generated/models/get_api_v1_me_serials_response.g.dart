// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_me_serials_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1MeSerialsResponse _$GetApiV1MeSerialsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1MeSerialsResponse(
  data: SerialListResponse.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1MeSerialsResponseToJson(
  GetApiV1MeSerialsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
