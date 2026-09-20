// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_chamber_days_id_walk_ins_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1ChamberDaysIdWalkInsResponse
_$PostApiV1ChamberDaysIdWalkInsResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1ChamberDaysIdWalkInsResponse(
      data: Serial.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1ChamberDaysIdWalkInsResponseToJson(
  PostApiV1ChamberDaysIdWalkInsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
