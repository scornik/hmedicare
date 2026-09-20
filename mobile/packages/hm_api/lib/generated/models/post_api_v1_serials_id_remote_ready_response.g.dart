// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_serials_id_remote_ready_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1SerialsIdRemoteReadyResponse
_$PostApiV1SerialsIdRemoteReadyResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1SerialsIdRemoteReadyResponse(
      data: Serial.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1SerialsIdRemoteReadyResponseToJson(
  PostApiV1SerialsIdRemoteReadyResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
