// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_serials_id_mark_waiting_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1SerialsIdMarkWaitingResponse
_$PostApiV1SerialsIdMarkWaitingResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1SerialsIdMarkWaitingResponse(
      data: Serial.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1SerialsIdMarkWaitingResponseToJson(
  PostApiV1SerialsIdMarkWaitingResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
