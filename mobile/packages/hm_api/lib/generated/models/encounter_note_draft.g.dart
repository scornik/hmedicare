// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'encounter_note_draft.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EncounterNoteDraft _$EncounterNoteDraftFromJson(Map<String, dynamic> json) =>
    EncounterNoteDraft(
      assessment: json['assessment'] as String?,
      authorDoctorProfileId: json['authorDoctorProfileId'] as String,
      chiefComplaint: json['chiefComplaint'] as String?,
      encounterId: json['encounterId'] as String,
      examination: json['examination'] as String?,
      history: json['history'] as String?,
      id: json['id'] as String,
      lastSignedRevision: (json['lastSignedRevision'] as num?)?.toInt(),
      plan: json['plan'] as String?,
      rowVersion: (json['rowVersion'] as num).toInt(),
      schemaVersion: (json['schemaVersion'] as num).toInt(),
      sectionSources: (json['sectionSources'] as List<dynamic>)
          .map((e) => NoteSectionSource.fromJson(e as Map<String, dynamic>))
          .toList(),
      status: EncounterNoteDraftStatus.fromJson(json['status'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );

Map<String, dynamic> _$EncounterNoteDraftToJson(EncounterNoteDraft instance) =>
    <String, dynamic>{
      'assessment': ?instance.assessment,
      'authorDoctorProfileId': instance.authorDoctorProfileId,
      'chiefComplaint': ?instance.chiefComplaint,
      'encounterId': instance.encounterId,
      'examination': ?instance.examination,
      'history': ?instance.history,
      'id': instance.id,
      'lastSignedRevision': ?instance.lastSignedRevision,
      'plan': ?instance.plan,
      'rowVersion': instance.rowVersion,
      'schemaVersion': instance.schemaVersion,
      'sectionSources': instance.sectionSources,
      'status': instance.status,
      'updatedAt': instance.updatedAt.toIso8601String(),
    };
