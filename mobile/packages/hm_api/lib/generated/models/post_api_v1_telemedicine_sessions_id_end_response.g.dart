// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_telemedicine_sessions_id_end_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1TelemedicineSessionsIdEndResponse
_$PostApiV1TelemedicineSessionsIdEndResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1TelemedicineSessionsIdEndResponse(
  data: TelemedicineSession.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1TelemedicineSessionsIdEndResponseToJson(
  PostApiV1TelemedicineSessionsIdEndResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
