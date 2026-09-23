// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'note_section_source_section.dart';
import 'note_section_source_source.dart';

part 'note_section_source.g.dart';

@JsonSerializable()
class NoteSectionSource {
  const NoteSectionSource({
    required this.section,
    required this.source,
    this.aiApprovalId,
  });
  
  factory NoteSectionSource.fromJson(Map<String, Object?> json) => _$NoteSectionSourceFromJson(json);
  
  final String? aiApprovalId;
  final NoteSectionSourceSection section;

  /// `ai_approved` is Stage 10; no route in this stage can produce it
  final NoteSectionSourceSource source;

  Map<String, Object?> toJson() => _$NoteSectionSourceToJson(this);
}
