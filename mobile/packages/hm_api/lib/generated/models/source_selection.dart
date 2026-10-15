// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'draft_sections.dart';

part 'source_selection.g.dart';

@JsonSerializable()
class SourceSelection {
  const SourceSelection({
    this.draftSections,
    this.lookbackDays,
    this.maxItems,
  });
  
  factory SourceSelection.fromJson(Map<String, Object?> json) => _$SourceSelectionFromJson(json);
  
  /// Sections of the current draft note the doctor chose to send
  final List<DraftSections>? draftSections;
  final int? lookbackDays;
  final int? maxItems;

  Map<String, Object?> toJson() => _$SourceSelectionToJson(this);
}
