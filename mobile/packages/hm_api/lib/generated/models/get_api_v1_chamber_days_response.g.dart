// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_chamber_days_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1ChamberDaysResponse _$GetApiV1ChamberDaysResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1ChamberDaysResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => ChamberDay.fromJson(e as Map<String, dynamic>))
      .toList(),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1ChamberDaysResponseToJson(
  GetApiV1ChamberDaysResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
