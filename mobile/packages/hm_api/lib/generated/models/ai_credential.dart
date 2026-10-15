// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_credential_billing_mode.dart';
import 'ai_credential_declared_tier.dart';
import 'ai_credential_status.dart';

part 'ai_credential.g.dart';

@JsonSerializable()
class AiCredential {
  const AiCredential({
    required this.billingMode,
    required this.declaredTier,
    required this.doctorProfileId,
    required this.id,
    required this.lastErrorClass,
    required this.providerCode,
    required this.rowVersion,
    required this.secretLast4,
    required this.status,
    required this.validatedAt,
  });
  
  factory AiCredential.fromJson(Map<String, Object?> json) => _$AiCredentialFromJson(json);
  
  final AiCredentialBillingMode billingMode;
  final AiCredentialDeclaredTier declaredTier;
  final String doctorProfileId;
  final String id;
  final String? lastErrorClass;
  final String providerCode;
  final int rowVersion;

  /// All a response ever carries of the key itself
  final String? secretLast4;
  final AiCredentialStatus status;
  final DateTime? validatedAt;

  Map<String, Object?> toJson() => _$AiCredentialToJson(this);
}
