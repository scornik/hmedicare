// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'chamber_day_status.dart';
import 'queue_policy.dart';

part 'chamber_day.g.dart';

@JsonSerializable()
class ChamberDay {
  const ChamberDay({
    required this.chamberId,
    required this.closedAt,
    required this.createdAt,
    required this.doctorProfileId,
    required this.expectedDelayMinutes,
    required this.id,
    required this.localDate,
    required this.localEndTime,
    required this.localStartTime,
    required this.nextSerialNumber,
    required this.queueOrderVersion,
    required this.queuePolicy,
    required this.rowVersion,
    required this.status,
    required this.timezone,
    required this.updatedAt,
  });
  
  factory ChamberDay.fromJson(Map<String, Object?> json) => _$ChamberDayFromJson(json);
  
  final String chamberId;
  final DateTime? closedAt;
  final DateTime createdAt;
  final String doctorProfileId;
  final int? expectedDelayMinutes;
  final String id;

  /// Calendar date (no time zone)
  final String localDate;

  /// Clinic-local time of day, HH:MM
  final String localEndTime;

  /// Clinic-local time of day, HH:MM
  final String localStartTime;
  final int nextSerialNumber;
  final int queueOrderVersion;
  final QueuePolicy queuePolicy;
  final int rowVersion;
  final ChamberDayStatus status;
  final String timezone;
  final DateTime updatedAt;

  Map<String, Object?> toJson() => _$ChamberDayToJson(this);
}
