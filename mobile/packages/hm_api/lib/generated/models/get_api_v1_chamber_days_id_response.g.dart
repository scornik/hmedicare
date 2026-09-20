// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_chamber_days_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1ChamberDaysIdResponse _$GetApiV1ChamberDaysIdResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1ChamberDaysIdResponse(
  data: ChamberDay.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1ChamberDaysIdResponseToJson(
  GetApiV1ChamberDaysIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
