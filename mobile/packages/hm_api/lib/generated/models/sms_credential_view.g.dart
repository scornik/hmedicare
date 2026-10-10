// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'sms_credential_view.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SmsCredentialView _$SmsCredentialViewFromJson(Map<String, dynamic> json) =>
    SmsCredentialView(
      balanceAlertBdt: json['balanceAlertBdt'] as String?,
      id: json['id'] as String,
      lastErrorClass: json['lastErrorClass'] as String?,
      providerCode: json['providerCode'] as String,
      providerKind: SmsCredentialViewProviderKind.fromJson(
        json['providerKind'] as String,
      ),
      publicIdentifier: json['publicIdentifier'] as String?,
      rowVersion: (json['rowVersion'] as num).toInt(),
      secretLast4: json['secretLast4'] as String,
      senderIdStatus: json['senderIdStatus'] as String?,
      status: SmsCredentialStatus.fromJson(json['status'] as String),
      tenantId: json['tenantId'] as String,
      validatedAt: json['validatedAt'] == null
          ? null
          : DateTime.parse(json['validatedAt'] as String),
    );

Map<String, dynamic> _$SmsCredentialViewToJson(SmsCredentialView instance) =>
    <String, dynamic>{
      'balanceAlertBdt': ?instance.balanceAlertBdt,
      'id': instance.id,
      'lastErrorClass': ?instance.lastErrorClass,
      'providerCode': instance.providerCode,
      'providerKind': instance.providerKind,
      'publicIdentifier': ?instance.publicIdentifier,
      'rowVersion': instance.rowVersion,
      'secretLast4': instance.secretLast4,
      'senderIdStatus': ?instance.senderIdStatus,
      'status': instance.status,
      'tenantId': instance.tenantId,
      'validatedAt': ?instance.validatedAt?.toIso8601String(),
    };
