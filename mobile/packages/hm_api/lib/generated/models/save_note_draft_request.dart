// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'sections.dart';

part 'save_note_draft_request.g.dart';

@JsonSerializable()
class SaveNoteDraftRequest {
  const SaveNoteDraftRequest({
    required this.expectedRowVersion,
    required this.sections,
  });
  
  factory SaveNoteDraftRequest.fromJson(Map<String, Object?> json) => _$SaveNoteDraftRequestFromJson(json);
  
  /// The draft's row version. A stale save is refused with STALE_VERSION and the current version, so a second tab never overwrites newer text
  final int expectedRowVersion;
  final Sections sections;

  Map<String, Object?> toJson() => _$SaveNoteDraftRequestToJson(this);
}
