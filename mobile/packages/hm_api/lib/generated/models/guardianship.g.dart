// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'guardianship.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Guardianship _$GuardianshipFromJson(Map<String, dynamic> json) => Guardianship(
  authorityScope: (json['authorityScope'] as List<dynamic>)
      .map((e) => GuardianshipAuthorityScope.fromJson(e as String))
      .toList(),
  createdAt: DateTime.parse(json['createdAt'] as String),
  dependentPatientId: json['dependentPatientId'] as String,
  endsOn: json['endsOn'] as String?,
  guardianPatientId: json['guardianPatientId'] as String?,
  guardianUserId: json['guardianUserId'] as String,
  id: json['id'] as String,
  relationship: GuardianshipRelationship.fromJson(
    json['relationship'] as String,
  ),
  rowVersion: (json['rowVersion'] as num).toInt(),
  startsOn: json['startsOn'] as String,
  status: GuardianshipStatus.fromJson(json['status'] as String),
  verificationMethod: json['verificationMethod'] == null
      ? null
      : GuardianshipVerificationMethod.fromJson(
          json['verificationMethod'] as String,
        ),
);

Map<String, dynamic> _$GuardianshipToJson(Guardianship instance) =>
    <String, dynamic>{
      'authorityScope': instance.authorityScope,
      'createdAt': instance.createdAt.toIso8601String(),
      'dependentPatientId': instance.dependentPatientId,
      'endsOn': ?instance.endsOn,
      'guardianPatientId': ?instance.guardianPatientId,
      'guardianUserId': instance.guardianUserId,
      'id': instance.id,
      'relationship': instance.relationship,
      'rowVersion': instance.rowVersion,
      'startsOn': instance.startsOn,
      'status': instance.status,
      'verificationMethod': ?instance.verificationMethod,
    };
