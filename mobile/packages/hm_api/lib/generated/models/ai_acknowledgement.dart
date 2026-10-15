// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_acknowledgement_tier.dart';

part 'ai_acknowledgement.g.dart';

@JsonSerializable()
class AiAcknowledgement {
  const AiAcknowledgement({
    required this.acknowledgedAt,
    required this.acknowledgedByUserId,
    required this.doctorProfileId,
    required this.id,
    required this.providerCode,
    required this.revokeReason,
    required this.revokedAt,
    required this.rowVersion,
    required this.termsTextSha256,
    required this.termsTextVersion,
    required this.tier,
  });
  
  factory AiAcknowledgement.fromJson(Map<String, Object?> json) => _$AiAcknowledgementFromJson(json);
  
  final DateTime acknowledgedAt;
  final String acknowledgedByUserId;
  final String doctorProfileId;
  final String id;
  final String providerCode;
  final String? revokeReason;
  final DateTime? revokedAt;
  final int rowVersion;
  final String termsTextSha256;
  final String termsTextVersion;
  final AiAcknowledgementTier tier;

  Map<String, Object?> toJson() => _$AiAcknowledgementToJson(this);
}
