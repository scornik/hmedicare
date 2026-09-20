// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cancel_chamber_day_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CancelChamberDayRequest _$CancelChamberDayRequestFromJson(
  Map<String, dynamic> json,
) => CancelChamberDayRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  reason: json['reason'] as String?,
);

Map<String, dynamic> _$CancelChamberDayRequestToJson(
  CancelChamberDayRequest instance,
) => <String, dynamic>{
  'expectedRowVersion': instance.expectedRowVersion,
  'reason': ?instance.reason,
};
