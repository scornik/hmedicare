// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_chamber_days_id_pause_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1ChamberDaysIdPauseResponse
_$PostApiV1ChamberDaysIdPauseResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1ChamberDaysIdPauseResponse(
      data: ChamberDay.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1ChamberDaysIdPauseResponseToJson(
  PostApiV1ChamberDaysIdPauseResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
