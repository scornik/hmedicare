// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_serials_id_confirm_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1SerialsIdConfirmResponse _$PostApiV1SerialsIdConfirmResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1SerialsIdConfirmResponse(
  data: Serial.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1SerialsIdConfirmResponseToJson(
  PostApiV1SerialsIdConfirmResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
