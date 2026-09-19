// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'activate_guardianship_request_authority_scope.dart';
import 'activate_guardianship_request_verification_method.dart';

part 'activate_guardianship_request.g.dart';

@JsonSerializable()
class ActivateGuardianshipRequest {
  const ActivateGuardianshipRequest({
    required this.expectedRowVersion,
    required this.verificationMethod,
    this.authorityScope,
    this.endsOn,
    this.evidenceRef,
    this.startsOn,
  });
  
  factory ActivateGuardianshipRequest.fromJson(Map<String, Object?> json) => _$ActivateGuardianshipRequestFromJson(json);
  
  final List<ActivateGuardianshipRequestAuthorityScope>? authorityScope;

  /// Calendar date (no time zone)
  final String? endsOn;
  final String? evidenceRef;
  final int expectedRowVersion;

  /// Calendar date (no time zone)
  final String? startsOn;
  final ActivateGuardianshipRequestVerificationMethod verificationMethod;

  Map<String, Object?> toJson() => _$ActivateGuardianshipRequestToJson(this);
}
