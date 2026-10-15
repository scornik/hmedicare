// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'after.g.dart';

@JsonSerializable()
class After {
  const After({
    required this.aiEnabled,
    required this.allowedProviderCodes,
    required this.freeTierAiAllowed,
    required this.minAiConsentPolicyVersion,
    required this.minimizationRequiredForNoTraining,
    required this.policyTextVersion,
    required this.rawOutputRetentionDays,
  });
  
  factory After.fromJson(Map<String, Object?> json) => _$AfterFromJson(json);
  
  final bool aiEnabled;
  final List<String> allowedProviderCodes;
  final bool freeTierAiAllowed;
  final int minAiConsentPolicyVersion;
  final bool minimizationRequiredForNoTraining;
  final String policyTextVersion;
  final int rawOutputRetentionDays;

  Map<String, Object?> toJson() => _$AfterToJson(this);
}
