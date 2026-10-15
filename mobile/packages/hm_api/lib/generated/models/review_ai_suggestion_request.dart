// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'review_ai_suggestion_request_decision.dart';

part 'review_ai_suggestion_request.g.dart';

@JsonSerializable()
class ReviewAiSuggestionRequest {
  const ReviewAiSuggestionRequest({
    required this.decision,
    required this.expectedRowVersion,
    this.editedCandidate,
  });
  
  factory ReviewAiSuggestionRequest.fromJson(Map<String, Object?> json) => _$ReviewAiSuggestionRequestFromJson(json);
  
  final ReviewAiSuggestionRequestDecision decision;

  /// Required for EDIT. Stored beside the model’s proposal, never replacing it
  final dynamic editedCandidate;
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$ReviewAiSuggestionRequestToJson(this);
}
