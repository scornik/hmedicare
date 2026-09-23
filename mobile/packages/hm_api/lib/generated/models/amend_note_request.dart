// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'amend_note_request.g.dart';

@JsonSerializable()
class AmendNoteRequest {
  const AmendNoteRequest({
    required this.correctionReason,
    required this.expectedRowVersion,
  });
  
  factory AmendNoteRequest.fromJson(Map<String, Object?> json) => _$AmendNoteRequestFromJson(json);
  
  /// Required. A revision after the first explains itself or it is not accepted
  final String correctionReason;
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$AmendNoteRequestToJson(this);
}
