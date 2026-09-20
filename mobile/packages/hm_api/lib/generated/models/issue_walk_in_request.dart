// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'duplicate_override.dart';
import 'issue_walk_in_request_care_mode.dart';

part 'issue_walk_in_request.g.dart';

@JsonSerializable()
class IssueWalkInRequest {
  const IssueWalkInRequest({
    required this.careMode,
    required this.patientId,
    this.duplicateOverride,
  });
  
  factory IssueWalkInRequest.fromJson(Map<String, Object?> json) => _$IssueWalkInRequestFromJson(json);
  
  final IssueWalkInRequestCareMode careMode;

  /// Issues a second active serial for the patient; role-gated by policy
  final DuplicateOverride? duplicateOverride;
  final String patientId;

  Map<String, Object?> toJson() => _$IssueWalkInRequestToJson(this);
}
