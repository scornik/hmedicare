// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_chamber_days_id_availability_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1ChamberDaysIdAvailabilityResponse
_$GetApiV1ChamberDaysIdAvailabilityResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1ChamberDaysIdAvailabilityResponse(
  data: ChamberDayAvailability.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1ChamberDaysIdAvailabilityResponseToJson(
  GetApiV1ChamberDaysIdAvailabilityResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
