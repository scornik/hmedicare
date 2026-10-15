// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_model_source.dart';
import 'ai_model_tier_availability.dart';

part 'ai_model.g.dart';

@JsonSerializable()
class AiModel {
  const AiModel({
    required this.capabilities,
    required this.contextTokens,
    required this.displayName,
    required this.lastVerifiedAt,
    required this.modelId,
    required this.providerCode,
    required this.source,
    required this.tierAvailability,
  });
  
  factory AiModel.fromJson(Map<String, Object?> json) => _$AiModelFromJson(json);
  
  final List<String> capabilities;
  final int? contextTokens;
  final String displayName;

  /// When a refresh last saw this model in the provider’s own list
  final DateTime lastVerifiedAt;

  /// The provider's own identifier, used verbatim. Never constructed by this platform
  final String modelId;
  final String providerCode;
  final AiModelSource source;
  final List<AiModelTierAvailability> tierAvailability;

  Map<String, Object?> toJson() => _$AiModelToJson(this);
}
