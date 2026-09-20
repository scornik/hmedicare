// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_serials_id_call_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1SerialsIdCallResponse _$PostApiV1SerialsIdCallResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1SerialsIdCallResponse(
  data: Serial.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1SerialsIdCallResponseToJson(
  PostApiV1SerialsIdCallResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
