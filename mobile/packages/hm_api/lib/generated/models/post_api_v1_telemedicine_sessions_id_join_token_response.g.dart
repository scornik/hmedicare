// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_telemedicine_sessions_id_join_token_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1TelemedicineSessionsIdJoinTokenResponse
_$PostApiV1TelemedicineSessionsIdJoinTokenResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1TelemedicineSessionsIdJoinTokenResponse(
  data: TelemedicineJoinToken.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1TelemedicineSessionsIdJoinTokenResponseToJson(
  PostApiV1TelemedicineSessionsIdJoinTokenResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
