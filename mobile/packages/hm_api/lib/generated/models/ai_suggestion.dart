// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_suggestion_confidence.dart';
import 'ai_suggestion_status.dart';
import 'ai_suggestion_suggestion_type.dart';
import 'source_refs.dart';

part 'ai_suggestion.g.dart';

@JsonSerializable()
class AiSuggestion {
  const AiSuggestion({
    required this.confidence,
    required this.id,
    required this.reviewedAt,
    required this.rowVersion,
    required this.sourceRefs,
    required this.status,
    required this.suggestionType,
    required this.targetSection,
    this.candidate,
    this.editedCandidate,
  });
  
  factory AiSuggestion.fromJson(Map<String, Object?> json) => _$AiSuggestionFromJson(json);
  
  /// What the model proposed
  final dynamic candidate;
  final AiSuggestionConfidence confidence;

  /// What the doctor revised it to
  final dynamic editedCandidate;
  final String id;
  final DateTime? reviewedAt;
  final int rowVersion;

  /// Always at least one; a suggestion citing nothing is never stored
  final List<SourceRefs> sourceRefs;
  final AiSuggestionStatus status;
  final AiSuggestionSuggestionType suggestionType;
  final String? targetSection;

  Map<String, Object?> toJson() => _$AiSuggestionToJson(this);
}
