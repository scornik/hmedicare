// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_acknowledgement_text.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiAcknowledgementText _$AiAcknowledgementTextFromJson(
  Map<String, dynamic> json,
) => AiAcknowledgementText(
  body: json['body'] as String,
  locale: AiAcknowledgementTextLocale.fromJson(json['locale'] as String),
  sha256: json['sha256'] as String,
  tier: AiAcknowledgementTextTier.fromJson(json['tier'] as String),
  version: json['version'] as String,
);

Map<String, dynamic> _$AiAcknowledgementTextToJson(
  AiAcknowledgementText instance,
) => <String, dynamic>{
  'body': instance.body,
  'locale': instance.locale,
  'sha256': instance.sha256,
  'tier': instance.tier,
  'version': instance.version,
};
