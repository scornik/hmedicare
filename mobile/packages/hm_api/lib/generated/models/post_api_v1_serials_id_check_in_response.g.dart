// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_serials_id_check_in_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1SerialsIdCheckInResponse _$PostApiV1SerialsIdCheckInResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1SerialsIdCheckInResponse(
  data: Serial.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1SerialsIdCheckInResponseToJson(
  PostApiV1SerialsIdCheckInResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
