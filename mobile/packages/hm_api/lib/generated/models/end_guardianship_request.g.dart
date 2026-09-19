// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'end_guardianship_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EndGuardianshipRequest _$EndGuardianshipRequestFromJson(
  Map<String, dynamic> json,
) => EndGuardianshipRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  reason: json['reason'] as String?,
);

Map<String, dynamic> _$EndGuardianshipRequestToJson(
  EndGuardianshipRequest instance,
) => <String, dynamic>{
  'expectedRowVersion': instance.expectedRowVersion,
  'reason': ?instance.reason,
};
