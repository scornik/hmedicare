// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_serials_id_no_show_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1SerialsIdNoShowResponse _$PostApiV1SerialsIdNoShowResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1SerialsIdNoShowResponse(
  data: Serial.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1SerialsIdNoShowResponseToJson(
  PostApiV1SerialsIdNoShowResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
