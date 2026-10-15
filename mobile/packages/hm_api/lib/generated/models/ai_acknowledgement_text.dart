// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_acknowledgement_text_locale.dart';
import 'ai_acknowledgement_text_tier.dart';

part 'ai_acknowledgement_text.g.dart';

@JsonSerializable()
class AiAcknowledgementText {
  const AiAcknowledgementText({
    required this.body,
    required this.locale,
    required this.sha256,
    required this.tier,
    required this.version,
  });
  
  factory AiAcknowledgementText.fromJson(Map<String, Object?> json) => _$AiAcknowledgementTextFromJson(json);
  
  final String body;
  final AiAcknowledgementTextLocale locale;
  final String sha256;
  final AiAcknowledgementTextTier tier;
  final String version;

  Map<String, Object?> toJson() => _$AiAcknowledgementTextToJson(this);
}
