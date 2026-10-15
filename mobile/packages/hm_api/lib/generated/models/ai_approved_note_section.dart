// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_approved_note_section_mode.dart';
import 'ai_approved_note_section_section.dart';

part 'ai_approved_note_section.g.dart';

@JsonSerializable()
class AiApprovedNoteSection {
  const AiApprovedNoteSection({
    required this.expectedNoteRowVersion,
    required this.mode,
    required this.section,
    required this.text,
  });
  
  factory AiApprovedNoteSection.fromJson(Map<String, Object?> json) => _$AiApprovedNoteSectionFromJson(json);
  
  final int expectedNoteRowVersion;

  /// APPEND joins what the doctor wrote; REPLACE substitutes the section
  final AiApprovedNoteSectionMode mode;
  final AiApprovedNoteSectionSection section;
  final String text;

  Map<String, Object?> toJson() => _$AiApprovedNoteSectionToJson(this);
}
