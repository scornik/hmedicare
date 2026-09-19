// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'request_guardianship_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RequestGuardianshipRequest _$RequestGuardianshipRequestFromJson(
  Map<String, dynamic> json,
) => RequestGuardianshipRequest(
  authorityScope: (json['authorityScope'] as List<dynamic>)
      .map(
        (e) => RequestGuardianshipRequestAuthorityScope.fromJson(e as String),
      )
      .toList(),
  relationship: RequestGuardianshipRequestRelationship.fromJson(
    json['relationship'] as String,
  ),
  guardianPatientId: json['guardianPatientId'] as String?,
  guardianUserId: json['guardianUserId'] as String?,
);

Map<String, dynamic> _$RequestGuardianshipRequestToJson(
  RequestGuardianshipRequest instance,
) => <String, dynamic>{
  'authorityScope': instance.authorityScope,
  'guardianPatientId': ?instance.guardianPatientId,
  'guardianUserId': ?instance.guardianUserId,
  'relationship': instance.relationship,
};
