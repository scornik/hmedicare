// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'note_section_source.dart';

part 'encounter_note_revision.g.dart';

@JsonSerializable()
class EncounterNoteRevision {
  const EncounterNoteRevision({
    required this.assessment,
    required this.chiefComplaint,
    required this.contentSha256,
    required this.correctionReason,
    required this.encounterId,
    required this.examination,
    required this.history,
    required this.id,
    required this.plan,
    required this.revision,
    required this.schemaVersion,
    required this.sectionSources,
    required this.signedAt,
    required this.signedByDoctorProfileId,
    required this.supersedesRevision,
  });
  
  factory EncounterNoteRevision.fromJson(Map<String, Object?> json) => _$EncounterNoteRevisionFromJson(json);
  
  final String? assessment;
  final String? chiefComplaint;

  /// Digest of the frozen sections. Lets a reader prove a revision is the one that was signed without anything outside the record holding a copy of the text
  final String contentSha256;
  final String? correctionReason;
  final String encounterId;
  final String? examination;
  final String? history;
  final String id;
  final String? plan;
  final int revision;
  final int schemaVersion;
  final List<NoteSectionSource> sectionSources;
  final DateTime signedAt;
  final String signedByDoctorProfileId;
  final int? supersedesRevision;

  Map<String, Object?> toJson() => _$EncounterNoteRevisionToJson(this);
}
