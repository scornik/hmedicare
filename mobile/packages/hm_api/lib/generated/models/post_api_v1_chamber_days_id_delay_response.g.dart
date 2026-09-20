// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_chamber_days_id_delay_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1ChamberDaysIdDelayResponse
_$PostApiV1ChamberDaysIdDelayResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1ChamberDaysIdDelayResponse(
      data: ChamberDay.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1ChamberDaysIdDelayResponseToJson(
  PostApiV1ChamberDaysIdDelayResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
