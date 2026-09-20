// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_chamber_days_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1ChamberDaysResponse _$PostApiV1ChamberDaysResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1ChamberDaysResponse(
  data: ChamberDay.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1ChamberDaysResponseToJson(
  PostApiV1ChamberDaysResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
