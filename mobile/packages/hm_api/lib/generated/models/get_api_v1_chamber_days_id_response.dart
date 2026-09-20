// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'chamber_day.dart';
import 'response_meta.dart';

part 'get_api_v1_chamber_days_id_response.g.dart';

@JsonSerializable()
class GetApiV1ChamberDaysIdResponse {
  const GetApiV1ChamberDaysIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1ChamberDaysIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1ChamberDaysIdResponseFromJson(json);
  
  final ChamberDay data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1ChamberDaysIdResponseToJson(this);
}
