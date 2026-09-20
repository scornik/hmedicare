// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'materialize_chamber_day_request.g.dart';

@JsonSerializable()
class MaterializeChamberDayRequest {
  const MaterializeChamberDayRequest({
    required this.chamberId,
    required this.localDate,
  });
  
  factory MaterializeChamberDayRequest.fromJson(Map<String, Object?> json) => _$MaterializeChamberDayRequestFromJson(json);
  
  final String chamberId;

  /// Calendar date (no time zone)
  final String localDate;

  Map<String, Object?> toJson() => _$MaterializeChamberDayRequestToJson(this);
}
