// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'record_ai_acknowledgement_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RecordAiAcknowledgementRequest _$RecordAiAcknowledgementRequestFromJson(
  Map<String, dynamic> json,
) => RecordAiAcknowledgementRequest(
  doctorProfileId: json['doctorProfileId'] as String,
  locale: RecordAiAcknowledgementRequestLocale.fromJson(
    json['locale'] as String,
  ),
  providerCode: json['providerCode'] as String,
  termsTextVersion: json['termsTextVersion'] as String,
  tier: RecordAiAcknowledgementRequestTier.fromJson(json['tier'] as String),
);

Map<String, dynamic> _$RecordAiAcknowledgementRequestToJson(
  RecordAiAcknowledgementRequest instance,
) => <String, dynamic>{
  'doctorProfileId': instance.doctorProfileId,
  'locale': instance.locale,
  'providerCode': instance.providerCode,
  'termsTextVersion': instance.termsTextVersion,
  'tier': instance.tier,
};
