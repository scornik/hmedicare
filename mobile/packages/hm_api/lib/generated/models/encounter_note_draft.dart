// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encounter_note_draft_status.dart';
import 'note_section_source.dart';

part 'encounter_note_draft.g.dart';

@JsonSerializable()
class EncounterNoteDraft {
  const EncounterNoteDraft({
    required this.assessment,
    required this.authorDoctorProfileId,
    required this.chiefComplaint,
    required this.encounterId,
    required this.examination,
    required this.history,
    required this.id,
    required this.lastSignedRevision,
    required this.plan,
    required this.rowVersion,
    required this.schemaVersion,
    required this.sectionSources,
    required this.status,
    required this.updatedAt,
  });
  
  factory EncounterNoteDraft.fromJson(Map<String, Object?> json) => _$EncounterNoteDraftFromJson(json);
  
  final String? assessment;
  final String authorDoctorProfileId;
  final String? chiefComplaint;
  final String encounterId;
  final String? examination;
  final String? history;
  final String id;
  final int? lastSignedRevision;
  final String? plan;
  final int rowVersion;
  final int schemaVersion;
  final List<NoteSectionSource> sectionSources;
  final EncounterNoteDraftStatus status;
  final DateTime updatedAt;

  Map<String, Object?> toJson() => _$EncounterNoteDraftToJson(this);
}
