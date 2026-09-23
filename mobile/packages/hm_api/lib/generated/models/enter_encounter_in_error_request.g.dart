// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'enter_encounter_in_error_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EnterEncounterInErrorRequest _$EnterEncounterInErrorRequestFromJson(
  Map<String, dynamic> json,
) => EnterEncounterInErrorRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  reason: json['reason'] as String,
);

Map<String, dynamic> _$EnterEncounterInErrorRequestToJson(
  EnterEncounterInErrorRequest instance,
) => <String, dynamic>{
  'expectedRowVersion': instance.expectedRowVersion,
  'reason': instance.reason,
};
