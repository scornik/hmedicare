// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'source_selection.dart';

part 'create_ai_job_request.g.dart';

@JsonSerializable()
class CreateAiJobRequest {
  const CreateAiJobRequest({
    required this.sourceSelection,
    this.credentialId,
    this.modelId,
    this.templateVersion,
  });
  
  factory CreateAiJobRequest.fromJson(Map<String, Object?> json) => _$CreateAiJobRequestFromJson(json);
  
  /// Defaults to the doctor’s highest-priority active credential
  final String? credentialId;
  final String? modelId;
  final SourceSelection sourceSelection;
  final String? templateVersion;

  Map<String, Object?> toJson() => _$CreateAiJobRequestToJson(this);
}
