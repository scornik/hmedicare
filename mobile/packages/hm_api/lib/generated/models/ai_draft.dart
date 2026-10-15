// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_draft_draft_type.dart';
import 'ai_draft_status.dart';
import 'ai_suggestion.dart';

part 'ai_draft.g.dart';

@JsonSerializable()
class AiDraft {
  const AiDraft({
    required this.aiJobId,
    required this.closedAt,
    required this.draftType,
    required this.droppedUnsourcedCount,
    required this.encounterId,
    required this.expiresAt,
    required this.id,
    required this.openedAt,
    required this.outputSchemaVersion,
    required this.rowVersion,
    required this.status,
    required this.suggestions,
  });
  
  factory AiDraft.fromJson(Map<String, Object?> json) => _$AiDraftFromJson(json);
  
  final String aiJobId;
  final DateTime? closedAt;
  final AiDraftDraftType draftType;

  /// Suggestions discarded for citing nothing, so a thin draft is explainable
  final int droppedUnsourcedCount;
  final String encounterId;
  final DateTime expiresAt;
  final String id;
  final DateTime? openedAt;
  final String outputSchemaVersion;
  final int rowVersion;
  final AiDraftStatus status;
  final List<AiSuggestion> suggestions;

  Map<String, Object?> toJson() => _$AiDraftToJson(this);
}
