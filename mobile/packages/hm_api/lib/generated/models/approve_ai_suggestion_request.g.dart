// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'approve_ai_suggestion_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApproveAiSuggestionRequest _$ApproveAiSuggestionRequestFromJson(
  Map<String, dynamic> json,
) => ApproveAiSuggestionRequest(
  approvedTarget: ApproveAiSuggestionRequestApprovedTarget.fromJson(
    json['approvedTarget'] as String,
  ),
  attestationVersion: (json['attestationVersion'] as num).toInt(),
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  diagnosis: json['diagnosis'] == null
      ? null
      : AiApprovedDiagnosis.fromJson(json['diagnosis'] as Map<String, dynamic>),
  noteSection: json['noteSection'] == null
      ? null
      : AiApprovedNoteSection.fromJson(
          json['noteSection'] as Map<String, dynamic>,
        ),
);

Map<String, dynamic> _$ApproveAiSuggestionRequestToJson(
  ApproveAiSuggestionRequest instance,
) => <String, dynamic>{
  'approvedTarget': instance.approvedTarget,
  'attestationVersion': instance.attestationVersion,
  'diagnosis': ?instance.diagnosis,
  'expectedRowVersion': instance.expectedRowVersion,
  'noteSection': ?instance.noteSection,
};
