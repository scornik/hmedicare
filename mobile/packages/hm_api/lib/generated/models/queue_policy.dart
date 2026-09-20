// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'day_close_disposition.dart';
import 'queue_policy_late_arrival_placement.dart';

part 'queue_policy.g.dart';

@JsonSerializable()
class QueuePolicy {
  const QueuePolicy({
    required this.advanceBookingEnabled,
    required this.allowRemoteCallWithoutReady,
    required this.autoNoShowEnabled,
    required this.autoSkipOnRecallDeadline,
    required this.avgConsultationMinutes,
    required this.bookingCutoffMinutes,
    required this.bookingWindowDays,
    required this.capacity,
    required this.dayCloseDisposition,
    required this.duplicateOverrideRoles,
    required this.earlyCheckInMinutes,
    required this.lateArrivalGraceMinutes,
    required this.lateArrivalPlacement,
    required this.maxBookedSerials,
    required this.maxWalkIns,
    required this.noShowAfterMinutes,
    required this.recallDeadlineMinutes,
    required this.recallLimit,
    required this.receptionistMayCall,
    required this.slotCapacity,
    required this.slotMinutes,
    required this.waitingRequiresConfirmation,
    required this.walkInsEnabled,
  });
  
  factory QueuePolicy.fromJson(Map<String, Object?> json) => _$QueuePolicyFromJson(json);
  
  final bool advanceBookingEnabled;
  final bool allowRemoteCallWithoutReady;
  final bool autoNoShowEnabled;
  final bool autoSkipOnRecallDeadline;
  final int avgConsultationMinutes;
  final int bookingCutoffMinutes;
  final int bookingWindowDays;
  final int? capacity;
  final DayCloseDisposition dayCloseDisposition;
  final List<String> duplicateOverrideRoles;
  final int earlyCheckInMinutes;
  final int lateArrivalGraceMinutes;
  final QueuePolicyLateArrivalPlacement lateArrivalPlacement;
  final int? maxBookedSerials;
  final int? maxWalkIns;
  final int noShowAfterMinutes;
  final int recallDeadlineMinutes;
  final int recallLimit;
  final bool receptionistMayCall;
  final int slotCapacity;
  final int? slotMinutes;
  final bool waitingRequiresConfirmation;
  final bool walkInsEnabled;

  Map<String, Object?> toJson() => _$QueuePolicyToJson(this);
}
