// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_serials_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1SerialsIdResponse _$GetApiV1SerialsIdResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1SerialsIdResponse(
  data: Serial.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1SerialsIdResponseToJson(
  GetApiV1SerialsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
