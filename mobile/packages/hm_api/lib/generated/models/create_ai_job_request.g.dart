// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'create_ai_job_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CreateAiJobRequest _$CreateAiJobRequestFromJson(Map<String, dynamic> json) =>
    CreateAiJobRequest(
      sourceSelection: SourceSelection.fromJson(
        json['sourceSelection'] as Map<String, dynamic>,
      ),
      credentialId: json['credentialId'] as String?,
      modelId: json['modelId'] as String?,
      templateVersion: json['templateVersion'] as String?,
    );

Map<String, dynamic> _$CreateAiJobRequestToJson(CreateAiJobRequest instance) =>
    <String, dynamic>{
      'credentialId': ?instance.credentialId,
      'modelId': ?instance.modelId,
      'sourceSelection': instance.sourceSelection,
      'templateVersion': ?instance.templateVersion,
    };
