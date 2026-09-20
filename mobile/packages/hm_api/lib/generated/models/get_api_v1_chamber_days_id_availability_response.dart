// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'chamber_day_availability.dart';
import 'response_meta.dart';

part 'get_api_v1_chamber_days_id_availability_response.g.dart';

@JsonSerializable()
class GetApiV1ChamberDaysIdAvailabilityResponse {
  const GetApiV1ChamberDaysIdAvailabilityResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1ChamberDaysIdAvailabilityResponse.fromJson(Map<String, Object?> json) => _$GetApiV1ChamberDaysIdAvailabilityResponseFromJson(json);
  
  final ChamberDayAvailability data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1ChamberDaysIdAvailabilityResponseToJson(this);
}
