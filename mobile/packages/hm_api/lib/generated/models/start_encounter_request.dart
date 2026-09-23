// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'start_encounter_request.g.dart';

@JsonSerializable()
class StartEncounterRequest {
  const StartEncounterRequest({
    required this.expectedRowVersion,
  });
  
  factory StartEncounterRequest.fromJson(Map<String, Object?> json) => _$StartEncounterRequestFromJson(json);
  
  /// The serial's row version, so a stale board cannot start a consultation twice
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$StartEncounterRequestToJson(this);
}
