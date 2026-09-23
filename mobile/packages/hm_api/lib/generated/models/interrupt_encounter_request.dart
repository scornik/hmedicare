// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'interrupt_encounter_request.g.dart';

@JsonSerializable()
class InterruptEncounterRequest {
  const InterruptEncounterRequest({
    required this.expectedRowVersion,
    required this.reason,
  });
  
  factory InterruptEncounterRequest.fromJson(Map<String, Object?> json) => _$InterruptEncounterRequestFromJson(json);
  
  final int expectedRowVersion;
  final String reason;

  Map<String, Object?> toJson() => _$InterruptEncounterRequestToJson(this);
}
