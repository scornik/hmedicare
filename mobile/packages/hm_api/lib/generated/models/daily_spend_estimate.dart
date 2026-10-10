// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'daily_spend_estimate.g.dart';

@JsonSerializable()
class DailySpendEstimate {
  const DailySpendEstimate({
    required this.day,
    required this.estimateBdt,
  });
  
  factory DailySpendEstimate.fromJson(Map<String, Object?> json) => _$DailySpendEstimateFromJson(json);
  
  final String day;
  final String estimateBdt;

  Map<String, Object?> toJson() => _$DailySpendEstimateToJson(this);
}
