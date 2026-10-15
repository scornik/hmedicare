// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_model.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiModel _$AiModelFromJson(Map<String, dynamic> json) => AiModel(
  capabilities: (json['capabilities'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
  contextTokens: (json['contextTokens'] as num?)?.toInt(),
  displayName: json['displayName'] as String,
  lastVerifiedAt: DateTime.parse(json['lastVerifiedAt'] as String),
  modelId: json['modelId'] as String,
  providerCode: json['providerCode'] as String,
  source: AiModelSource.fromJson(json['source'] as String),
  tierAvailability: (json['tierAvailability'] as List<dynamic>)
      .map((e) => AiModelTierAvailability.fromJson(e as String))
      .toList(),
);

Map<String, dynamic> _$AiModelToJson(AiModel instance) => <String, dynamic>{
  'capabilities': instance.capabilities,
  'contextTokens': ?instance.contextTokens,
  'displayName': instance.displayName,
  'lastVerifiedAt': instance.lastVerifiedAt.toIso8601String(),
  'modelId': instance.modelId,
  'providerCode': instance.providerCode,
  'source': instance.source,
  'tierAvailability': instance.tierAvailability,
};
