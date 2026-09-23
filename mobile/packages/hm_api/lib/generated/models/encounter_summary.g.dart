// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'encounter_summary.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EncounterSummary _$EncounterSummaryFromJson(Map<String, dynamic> json) =>
    EncounterSummary(
      careMode: EncounterSummaryCareMode.fromJson(json['careMode'] as String),
      chamberId: json['chamberId'] as String,
      completedAt: json['completedAt'] == null
          ? null
          : DateTime.parse(json['completedAt'] as String),
      doctorProfileId: json['doctorProfileId'] as String,
      id: json['id'] as String,
      legacyInterim: json['legacyInterim'] as bool,
      signedRevisions: (json['signedRevisions'] as num).toInt(),
      startedAt: DateTime.parse(json['startedAt'] as String),
      status: EncounterSummaryStatus.fromJson(json['status'] as String),
    );

Map<String, dynamic> _$EncounterSummaryToJson(EncounterSummary instance) =>
    <String, dynamic>{
      'careMode': instance.careMode,
      'chamberId': instance.chamberId,
      'completedAt': ?instance.completedAt?.toIso8601String(),
      'doctorProfileId': instance.doctorProfileId,
      'id': instance.id,
      'legacyInterim': instance.legacyInterim,
      'signedRevisions': instance.signedRevisions,
      'startedAt': instance.startedAt.toIso8601String(),
      'status': instance.status,
    };
