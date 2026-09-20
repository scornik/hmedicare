// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_serials_id_recall_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1SerialsIdRecallResponse _$PostApiV1SerialsIdRecallResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1SerialsIdRecallResponse(
  data: Serial.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1SerialsIdRecallResponseToJson(
  PostApiV1SerialsIdRecallResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
