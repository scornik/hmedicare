// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'record_ai_acknowledgement_request_locale.dart';
import 'record_ai_acknowledgement_request_tier.dart';

part 'record_ai_acknowledgement_request.g.dart';

@JsonSerializable()
class RecordAiAcknowledgementRequest {
  const RecordAiAcknowledgementRequest({
    required this.doctorProfileId,
    required this.locale,
    required this.providerCode,
    required this.termsTextVersion,
    required this.tier,
  });
  
  factory RecordAiAcknowledgementRequest.fromJson(Map<String, Object?> json) => _$RecordAiAcknowledgementRequestFromJson(json);
  
  final String doctorProfileId;
  final RecordAiAcknowledgementRequestLocale locale;
  final String providerCode;

  /// The version the screen displayed; a superseded version is refused
  final String termsTextVersion;
  final RecordAiAcknowledgementRequestTier tier;

  Map<String, Object?> toJson() => _$RecordAiAcknowledgementRequestToJson(this);
}
