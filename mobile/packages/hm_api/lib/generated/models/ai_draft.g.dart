// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_draft.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiDraft _$AiDraftFromJson(Map<String, dynamic> json) => AiDraft(
  aiJobId: json['aiJobId'] as String,
  closedAt: json['closedAt'] == null
      ? null
      : DateTime.parse(json['closedAt'] as String),
  draftType: AiDraftDraftType.fromJson(json['draftType'] as String),
  droppedUnsourcedCount: (json['droppedUnsourcedCount'] as num).toInt(),
  encounterId: json['encounterId'] as String,
  expiresAt: DateTime.parse(json['expiresAt'] as String),
  id: json['id'] as String,
  openedAt: json['openedAt'] == null
      ? null
      : DateTime.parse(json['openedAt'] as String),
  outputSchemaVersion: json['outputSchemaVersion'] as String,
  rowVersion: (json['rowVersion'] as num).toInt(),
  status: AiDraftStatus.fromJson(json['status'] as String),
  suggestions: (json['suggestions'] as List<dynamic>)
      .map((e) => AiSuggestion.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$AiDraftToJson(AiDraft instance) => <String, dynamic>{
  'aiJobId': instance.aiJobId,
  'closedAt': ?instance.closedAt?.toIso8601String(),
  'draftType': instance.draftType,
  'droppedUnsourcedCount': instance.droppedUnsourcedCount,
  'encounterId': instance.encounterId,
  'expiresAt': instance.expiresAt.toIso8601String(),
  'id': instance.id,
  'openedAt': ?instance.openedAt?.toIso8601String(),
  'outputSchemaVersion': instance.outputSchemaVersion,
  'rowVersion': instance.rowVersion,
  'status': instance.status,
  'suggestions': instance.suggestions,
};
