// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'day_close_disposition2.dart';
import 'queue_policy_patch_late_arrival_placement.dart';

part 'queue_policy_patch.g.dart';

@JsonSerializable()
class QueuePolicyPatch {
  const QueuePolicyPatch({
    this.advanceBookingEnabled,
    this.allowRemoteCallWithoutReady,
    this.autoNoShowEnabled,
    this.autoSkipOnRecallDeadline,
    this.avgConsultationMinutes,
    this.bookingCutoffMinutes,
    this.bookingWindowDays,
    this.capacity,
    this.dayCloseDisposition,
    this.duplicateOverrideRoles,
    this.earlyCheckInMinutes,
    this.lateArrivalGraceMinutes,
    this.lateArrivalPlacement,
    this.maxBookedSerials,
    this.maxWalkIns,
    this.noShowAfterMinutes,
    this.recallDeadlineMinutes,
    this.recallLimit,
    this.receptionistMayCall,
    this.slotCapacity,
    this.slotMinutes,
    this.waitingRequiresConfirmation,
    this.walkInsEnabled,
  });
  
  factory QueuePolicyPatch.fromJson(Map<String, Object?> json) => _$QueuePolicyPatchFromJson(json);
  
  final bool? advanceBookingEnabled;
  final bool? allowRemoteCallWithoutReady;
  final bool? autoNoShowEnabled;
  final bool? autoSkipOnRecallDeadline;
  final int? avgConsultationMinutes;
  final int? bookingCutoffMinutes;
  final int? bookingWindowDays;
  final int? capacity;
  final DayCloseDisposition2? dayCloseDisposition;
  final List<String>? duplicateOverrideRoles;
  final int? earlyCheckInMinutes;
  final int? lateArrivalGraceMinutes;
  final QueuePolicyPatchLateArrivalPlacement? lateArrivalPlacement;
  final int? maxBookedSerials;
  final int? maxWalkIns;
  final int? noShowAfterMinutes;
  final int? recallDeadlineMinutes;
  final int? recallLimit;
  final bool? receptionistMayCall;
  final int? slotCapacity;
  final int? slotMinutes;
  final bool? waitingRequiresConfirmation;
  final bool? walkInsEnabled;

  Map<String, Object?> toJson() => _$QueuePolicyPatchToJson(this);
}
