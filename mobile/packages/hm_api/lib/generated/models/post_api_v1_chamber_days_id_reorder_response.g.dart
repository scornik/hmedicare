// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_chamber_days_id_reorder_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1ChamberDaysIdReorderResponse
_$PostApiV1ChamberDaysIdReorderResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1ChamberDaysIdReorderResponse(
      data: QueueSnapshot.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1ChamberDaysIdReorderResponseToJson(
  PostApiV1ChamberDaysIdReorderResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
