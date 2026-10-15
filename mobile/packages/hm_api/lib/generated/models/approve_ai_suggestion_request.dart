// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_approved_diagnosis.dart';
import 'ai_approved_note_section.dart';
import 'approve_ai_suggestion_request_approved_target.dart';

part 'approve_ai_suggestion_request.g.dart';

@JsonSerializable()
class ApproveAiSuggestionRequest {
  const ApproveAiSuggestionRequest({
    required this.approvedTarget,
    required this.attestationVersion,
    required this.expectedRowVersion,
    this.diagnosis,
    this.noteSection,
  });
  
  factory ApproveAiSuggestionRequest.fromJson(Map<String, Object?> json) => _$ApproveAiSuggestionRequestFromJson(json);
  
  final ApproveAiSuggestionRequestApprovedTarget approvedTarget;
  final int attestationVersion;
  final AiApprovedDiagnosis? diagnosis;
  final int expectedRowVersion;
  final AiApprovedNoteSection? noteSection;

  Map<String, Object?> toJson() => _$ApproveAiSuggestionRequestToJson(this);
}
