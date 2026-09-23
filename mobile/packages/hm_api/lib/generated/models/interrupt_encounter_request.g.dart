// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'interrupt_encounter_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

InterruptEncounterRequest _$InterruptEncounterRequestFromJson(
  Map<String, dynamic> json,
) => InterruptEncounterRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  reason: json['reason'] as String,
);

Map<String, dynamic> _$InterruptEncounterRequestToJson(
  InterruptEncounterRequest instance,
) => <String, dynamic>{
  'expectedRowVersion': instance.expectedRowVersion,
  'reason': instance.reason,
};
