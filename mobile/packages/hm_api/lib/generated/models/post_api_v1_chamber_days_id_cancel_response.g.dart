// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_chamber_days_id_cancel_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1ChamberDaysIdCancelResponse
_$PostApiV1ChamberDaysIdCancelResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1ChamberDaysIdCancelResponse(
      data: ChamberDay.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1ChamberDaysIdCancelResponseToJson(
  PostApiV1ChamberDaysIdCancelResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
