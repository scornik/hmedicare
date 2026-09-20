// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'queue_policy.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

QueuePolicy _$QueuePolicyFromJson(Map<String, dynamic> json) => QueuePolicy(
  advanceBookingEnabled: json['advanceBookingEnabled'] as bool,
  allowRemoteCallWithoutReady: json['allowRemoteCallWithoutReady'] as bool,
  autoNoShowEnabled: json['autoNoShowEnabled'] as bool,
  autoSkipOnRecallDeadline: json['autoSkipOnRecallDeadline'] as bool,
  avgConsultationMinutes: (json['avgConsultationMinutes'] as num).toInt(),
  bookingCutoffMinutes: (json['bookingCutoffMinutes'] as num).toInt(),
  bookingWindowDays: (json['bookingWindowDays'] as num).toInt(),
  capacity: (json['capacity'] as num?)?.toInt(),
  dayCloseDisposition: DayCloseDisposition.fromJson(
    json['dayCloseDisposition'] as Map<String, dynamic>,
  ),
  duplicateOverrideRoles: (json['duplicateOverrideRoles'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
  earlyCheckInMinutes: (json['earlyCheckInMinutes'] as num).toInt(),
  lateArrivalGraceMinutes: (json['lateArrivalGraceMinutes'] as num).toInt(),
  lateArrivalPlacement: QueuePolicyLateArrivalPlacement.fromJson(
    json['lateArrivalPlacement'] as String,
  ),
  maxBookedSerials: (json['maxBookedSerials'] as num?)?.toInt(),
  maxWalkIns: (json['maxWalkIns'] as num?)?.toInt(),
  noShowAfterMinutes: (json['noShowAfterMinutes'] as num).toInt(),
  recallDeadlineMinutes: (json['recallDeadlineMinutes'] as num).toInt(),
  recallLimit: (json['recallLimit'] as num).toInt(),
  receptionistMayCall: json['receptionistMayCall'] as bool,
  slotCapacity: (json['slotCapacity'] as num).toInt(),
  slotMinutes: (json['slotMinutes'] as num?)?.toInt(),
  waitingRequiresConfirmation: json['waitingRequiresConfirmation'] as bool,
  walkInsEnabled: json['walkInsEnabled'] as bool,
);

Map<String, dynamic> _$QueuePolicyToJson(QueuePolicy instance) =>
    <String, dynamic>{
      'advanceBookingEnabled': instance.advanceBookingEnabled,
      'allowRemoteCallWithoutReady': instance.allowRemoteCallWithoutReady,
      'autoNoShowEnabled': instance.autoNoShowEnabled,
      'autoSkipOnRecallDeadline': instance.autoSkipOnRecallDeadline,
      'avgConsultationMinutes': instance.avgConsultationMinutes,
      'bookingCutoffMinutes': instance.bookingCutoffMinutes,
      'bookingWindowDays': instance.bookingWindowDays,
      'capacity': ?instance.capacity,
      'dayCloseDisposition': instance.dayCloseDisposition,
      'duplicateOverrideRoles': instance.duplicateOverrideRoles,
      'earlyCheckInMinutes': instance.earlyCheckInMinutes,
      'lateArrivalGraceMinutes': instance.lateArrivalGraceMinutes,
      'lateArrivalPlacement': instance.lateArrivalPlacement,
      'maxBookedSerials': ?instance.maxBookedSerials,
      'maxWalkIns': ?instance.maxWalkIns,
      'noShowAfterMinutes': instance.noShowAfterMinutes,
      'recallDeadlineMinutes': instance.recallDeadlineMinutes,
      'recallLimit': instance.recallLimit,
      'receptionistMayCall': instance.receptionistMayCall,
      'slotCapacity': instance.slotCapacity,
      'slotMinutes': ?instance.slotMinutes,
      'waitingRequiresConfirmation': instance.waitingRequiresConfirmation,
      'walkInsEnabled': instance.walkInsEnabled,
    };
