// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_chamber_days_id_open_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1ChamberDaysIdOpenResponse _$PostApiV1ChamberDaysIdOpenResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1ChamberDaysIdOpenResponse(
  data: ChamberDay.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1ChamberDaysIdOpenResponseToJson(
  PostApiV1ChamberDaysIdOpenResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
