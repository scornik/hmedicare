// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_suggestion.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiSuggestion _$AiSuggestionFromJson(Map<String, dynamic> json) => AiSuggestion(
  confidence: AiSuggestionConfidence.fromJson(json['confidence'] as String),
  id: json['id'] as String,
  reviewedAt: json['reviewedAt'] == null
      ? null
      : DateTime.parse(json['reviewedAt'] as String),
  rowVersion: (json['rowVersion'] as num).toInt(),
  sourceRefs: (json['sourceRefs'] as List<dynamic>)
      .map((e) => SourceRefs.fromJson(e as Map<String, dynamic>))
      .toList(),
  status: AiSuggestionStatus.fromJson(json['status'] as String),
  suggestionType: AiSuggestionSuggestionType.fromJson(
    json['suggestionType'] as String,
  ),
  targetSection: json['targetSection'] as String?,
  candidate: json['candidate'],
  editedCandidate: json['editedCandidate'],
);

Map<String, dynamic> _$AiSuggestionToJson(AiSuggestion instance) =>
    <String, dynamic>{
      'candidate': ?instance.candidate,
      'confidence': instance.confidence,
      'editedCandidate': ?instance.editedCandidate,
      'id': instance.id,
      'reviewedAt': ?instance.reviewedAt?.toIso8601String(),
      'rowVersion': instance.rowVersion,
      'sourceRefs': instance.sourceRefs,
      'status': instance.status,
      'suggestionType': instance.suggestionType,
      'targetSection': ?instance.targetSection,
    };
