// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_serials_id_complete_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1SerialsIdCompleteResponse _$PostApiV1SerialsIdCompleteResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1SerialsIdCompleteResponse(
  data: Serial.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1SerialsIdCompleteResponseToJson(
  PostApiV1SerialsIdCompleteResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
