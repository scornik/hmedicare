// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patient_serial_view.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatientSerialView _$PatientSerialViewFromJson(Map<String, dynamic> json) =>
    PatientSerialView(
      asOf: DateTime.parse(json['asOf'] as String),
      careMode: PatientSerialViewCareMode.fromJson(json['careMode'] as String),
      chamberDayId: json['chamberDayId'] as String,
      dayStatus: PatientSerialViewDayStatus.fromJson(
        json['dayStatus'] as String,
      ),
      estimatedPosition: (json['estimatedPosition'] as num?)?.toInt(),
      estimatedWaitMinutes: (json['estimatedWaitMinutes'] as num?)?.toInt(),
      expectedDelayMinutes: (json['expectedDelayMinutes'] as num?)?.toInt(),
      localDate: json['localDate'] as String,
      peopleAhead: (json['peopleAhead'] as num?)?.toInt(),
      recallDeadlineAt: json['recallDeadlineAt'] == null
          ? null
          : DateTime.parse(json['recallDeadlineAt'] as String),
      recallsRemaining: (json['recallsRemaining'] as num?)?.toInt(),
      rowVersion: (json['rowVersion'] as num).toInt(),
      serialId: json['serialId'] as String,
      serialNumber: (json['serialNumber'] as num).toInt(),
      status: PatientSerialViewStatus.fromJson(json['status'] as String),
    );

Map<String, dynamic> _$PatientSerialViewToJson(PatientSerialView instance) =>
    <String, dynamic>{
      'asOf': instance.asOf.toIso8601String(),
      'careMode': instance.careMode,
      'chamberDayId': instance.chamberDayId,
      'dayStatus': instance.dayStatus,
      'estimatedPosition': ?instance.estimatedPosition,
      'estimatedWaitMinutes': ?instance.estimatedWaitMinutes,
      'expectedDelayMinutes': ?instance.expectedDelayMinutes,
      'localDate': instance.localDate,
      'peopleAhead': ?instance.peopleAhead,
      'recallDeadlineAt': ?instance.recallDeadlineAt?.toIso8601String(),
      'recallsRemaining': ?instance.recallsRemaining,
      'rowVersion': instance.rowVersion,
      'serialId': instance.serialId,
      'serialNumber': instance.serialNumber,
      'status': instance.status,
    };
