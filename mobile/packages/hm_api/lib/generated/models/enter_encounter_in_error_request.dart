// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'enter_encounter_in_error_request.g.dart';

@JsonSerializable()
class EnterEncounterInErrorRequest {
  const EnterEncounterInErrorRequest({
    required this.expectedRowVersion,
    required this.reason,
  });
  
  factory EnterEncounterInErrorRequest.fromJson(Map<String, Object?> json) => _$EnterEncounterInErrorRequestFromJson(json);
  
  final int expectedRowVersion;

  /// Required. The row is kept for the audit trail, so the reason is the record
  final String reason;

  Map<String, Object?> toJson() => _$EnterEncounterInErrorRequestToJson(this);
}
