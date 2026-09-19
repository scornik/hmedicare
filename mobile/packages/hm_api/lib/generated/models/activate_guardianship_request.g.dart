// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'activate_guardianship_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ActivateGuardianshipRequest _$ActivateGuardianshipRequestFromJson(
  Map<String, dynamic> json,
) => ActivateGuardianshipRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  verificationMethod: ActivateGuardianshipRequestVerificationMethod.fromJson(
    json['verificationMethod'] as String,
  ),
  authorityScope: (json['authorityScope'] as List<dynamic>?)
      ?.map(
        (e) => ActivateGuardianshipRequestAuthorityScope.fromJson(e as String),
      )
      .toList(),
  endsOn: json['endsOn'] as String?,
  evidenceRef: json['evidenceRef'] as String?,
  startsOn: json['startsOn'] as String?,
);

Map<String, dynamic> _$ActivateGuardianshipRequestToJson(
  ActivateGuardianshipRequest instance,
) => <String, dynamic>{
  'authorityScope': ?instance.authorityScope,
  'endsOn': ?instance.endsOn,
  'evidenceRef': ?instance.evidenceRef,
  'expectedRowVersion': instance.expectedRowVersion,
  'startsOn': ?instance.startsOn,
  'verificationMethod': instance.verificationMethod,
};
