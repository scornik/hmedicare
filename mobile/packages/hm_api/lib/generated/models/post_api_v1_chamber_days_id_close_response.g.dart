// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_chamber_days_id_close_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1ChamberDaysIdCloseResponse
_$PostApiV1ChamberDaysIdCloseResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1ChamberDaysIdCloseResponse(
      data: ChamberDay.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1ChamberDaysIdCloseResponseToJson(
  PostApiV1ChamberDaysIdCloseResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
