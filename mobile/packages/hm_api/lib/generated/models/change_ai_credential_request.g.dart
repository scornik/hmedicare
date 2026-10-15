// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'change_ai_credential_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ChangeAiCredentialRequest _$ChangeAiCredentialRequestFromJson(
  Map<String, dynamic> json,
) => ChangeAiCredentialRequest(
  action: ChangeAiCredentialRequestAction.fromJson(json['action'] as String),
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
);

Map<String, dynamic> _$ChangeAiCredentialRequestToJson(
  ChangeAiCredentialRequest instance,
) => <String, dynamic>{
  'action': instance.action,
  'expectedRowVersion': instance.expectedRowVersion,
};
