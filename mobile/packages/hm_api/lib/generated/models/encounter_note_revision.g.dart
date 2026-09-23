// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'encounter_note_revision.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EncounterNoteRevision _$EncounterNoteRevisionFromJson(
  Map<String, dynamic> json,
) => EncounterNoteRevision(
  assessment: json['assessment'] as String?,
  chiefComplaint: json['chiefComplaint'] as String?,
  contentSha256: json['contentSha256'] as String,
  correctionReason: json['correctionReason'] as String?,
  encounterId: json['encounterId'] as String,
  examination: json['examination'] as String?,
  history: json['history'] as String?,
  id: json['id'] as String,
  plan: json['plan'] as String?,
  revision: (json['revision'] as num).toInt(),
  schemaVersion: (json['schemaVersion'] as num).toInt(),
  sectionSources: (json['sectionSources'] as List<dynamic>)
      .map((e) => NoteSectionSource.fromJson(e as Map<String, dynamic>))
      .toList(),
  signedAt: DateTime.parse(json['signedAt'] as String),
  signedByDoctorProfileId: json['signedByDoctorProfileId'] as String,
  supersedesRevision: (json['supersedesRevision'] as num?)?.toInt(),
);

Map<String, dynamic> _$EncounterNoteRevisionToJson(
  EncounterNoteRevision instance,
) => <String, dynamic>{
  'assessment': ?instance.assessment,
  'chiefComplaint': ?instance.chiefComplaint,
  'contentSha256': instance.contentSha256,
  'correctionReason': ?instance.correctionReason,
  'encounterId': instance.encounterId,
  'examination': ?instance.examination,
  'history': ?instance.history,
  'id': instance.id,
  'plan': ?instance.plan,
  'revision': instance.revision,
  'schemaVersion': instance.schemaVersion,
  'sectionSources': instance.sectionSources,
  'signedAt': instance.signedAt.toIso8601String(),
  'signedByDoctorProfileId': instance.signedByDoctorProfileId,
  'supersedesRevision': ?instance.supersedesRevision,
};
