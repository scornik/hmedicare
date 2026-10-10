// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'sms_credential_status.dart';
import 'sms_credential_view_provider_kind.dart';

part 'sms_credential_view.g.dart';

@JsonSerializable()
class SmsCredentialView {
  const SmsCredentialView({
    required this.balanceAlertBdt,
    required this.id,
    required this.lastErrorClass,
    required this.providerCode,
    required this.providerKind,
    required this.publicIdentifier,
    required this.rowVersion,
    required this.secretLast4,
    required this.senderIdStatus,
    required this.status,
    required this.tenantId,
    required this.validatedAt,
  });
  
  factory SmsCredentialView.fromJson(Map<String, Object?> json) => _$SmsCredentialViewFromJson(json);
  
  final String? balanceAlertBdt;
  final String id;
  final String? lastErrorClass;
  final String providerCode;
  final SmsCredentialViewProviderKind providerKind;
  final String? publicIdentifier;
  final int rowVersion;
  final String secretLast4;
  final String? senderIdStatus;
  final SmsCredentialStatus status;
  final String tenantId;
  final DateTime? validatedAt;

  Map<String, Object?> toJson() => _$SmsCredentialViewToJson(this);
}
