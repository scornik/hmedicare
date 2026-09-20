// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_serials_id_start_consultation_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1SerialsIdStartConsultationResponse
_$PostApiV1SerialsIdStartConsultationResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1SerialsIdStartConsultationResponse(
  data: Serial.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1SerialsIdStartConsultationResponseToJson(
  PostApiV1SerialsIdStartConsultationResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
