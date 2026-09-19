// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'request_guardianship_request_authority_scope.dart';
import 'request_guardianship_request_relationship.dart';

part 'request_guardianship_request.g.dart';

@JsonSerializable()
class RequestGuardianshipRequest {
  const RequestGuardianshipRequest({
    required this.authorityScope,
    required this.relationship,
    this.guardianPatientId,
    this.guardianUserId,
  });
  
  factory RequestGuardianshipRequest.fromJson(Map<String, Object?> json) => _$RequestGuardianshipRequestFromJson(json);
  
  final List<RequestGuardianshipRequestAuthorityScope> authorityScope;
  final String? guardianPatientId;

  /// Staff only; a patient user is always the guardian
  final String? guardianUserId;
  final RequestGuardianshipRequestRelationship relationship;

  Map<String, Object?> toJson() => _$RequestGuardianshipRequestToJson(this);
}
