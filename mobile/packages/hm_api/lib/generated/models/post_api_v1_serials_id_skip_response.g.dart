// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_serials_id_skip_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1SerialsIdSkipResponse _$PostApiV1SerialsIdSkipResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1SerialsIdSkipResponse(
  data: Serial.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1SerialsIdSkipResponseToJson(
  PostApiV1SerialsIdSkipResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
