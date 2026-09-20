// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'cancel_chamber_day_request.g.dart';

@JsonSerializable()
class CancelChamberDayRequest {
  const CancelChamberDayRequest({
    required this.expectedRowVersion,
    this.reason,
  });
  
  factory CancelChamberDayRequest.fromJson(Map<String, Object?> json) => _$CancelChamberDayRequestFromJson(json);
  
  final int expectedRowVersion;
  final String? reason;

  Map<String, Object?> toJson() => _$CancelChamberDayRequestToJson(this);
}
