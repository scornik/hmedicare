// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'create_ai_credential_request_billing_mode.dart';
import 'create_ai_credential_request_declared_tier.dart';

part 'create_ai_credential_request.g.dart';

@JsonSerializable()
class CreateAiCredentialRequest {
  const CreateAiCredentialRequest({
    required this.billingMode,
    required this.declaredTier,
    required this.providerCode,
    required this.secret,
    this.dataUseAckId,
  });
  
  factory CreateAiCredentialRequest.fromJson(Map<String, Object?> json) => _$CreateAiCredentialRequestFromJson(json);
  
  final CreateAiCredentialRequestBillingMode billingMode;

  /// The live acknowledgement permitting this credential. Revoking it returns the credential to PENDING_VALIDATION
  final String? dataUseAckId;
  final CreateAiCredentialRequestDeclaredTier declaredTier;
  final String providerCode;

  /// Write-only. Sealed on arrival and never returned by any route
  final String secret;

  Map<String, Object?> toJson() => _$CreateAiCredentialRequestToJson(this);
}
