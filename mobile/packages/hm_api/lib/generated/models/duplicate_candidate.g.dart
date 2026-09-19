// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'duplicate_candidate.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DuplicateCandidate _$DuplicateCandidateFromJson(Map<String, dynamic> json) =>
    DuplicateCandidate(
      patient: PatientSummary.fromJson(json['patient'] as Map<String, dynamic>),
      reasons: (json['reasons'] as List<dynamic>)
          .map((e) => DuplicateCandidateReasons.fromJson(e as String))
          .toList(),
      score: json['score'] as num,
    );

Map<String, dynamic> _$DuplicateCandidateToJson(DuplicateCandidate instance) =>
    <String, dynamic>{
      'patient': instance.patient,
      'reasons': instance.reasons,
      'score': instance.score,
    };
