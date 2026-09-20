// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_serials_id_cancel_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1SerialsIdCancelResponse _$PostApiV1SerialsIdCancelResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1SerialsIdCancelResponse(
  data: Serial.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1SerialsIdCancelResponseToJson(
  PostApiV1SerialsIdCancelResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
