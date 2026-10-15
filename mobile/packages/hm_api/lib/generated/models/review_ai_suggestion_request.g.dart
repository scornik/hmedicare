// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'review_ai_suggestion_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ReviewAiSuggestionRequest _$ReviewAiSuggestionRequestFromJson(
  Map<String, dynamic> json,
) => ReviewAiSuggestionRequest(
  decision: ReviewAiSuggestionRequestDecision.fromJson(
    json['decision'] as String,
  ),
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  editedCandidate: json['editedCandidate'],
);

Map<String, dynamic> _$ReviewAiSuggestionRequestToJson(
  ReviewAiSuggestionRequest instance,
) => <String, dynamic>{
  'decision': instance.decision,
  'editedCandidate': ?instance.editedCandidate,
  'expectedRowVersion': instance.expectedRowVersion,
};
