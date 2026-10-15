// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'change_ai_credential_request_action.dart';

part 'change_ai_credential_request.g.dart';

@JsonSerializable()
class ChangeAiCredentialRequest {
  const ChangeAiCredentialRequest({
    required this.action,
    required this.expectedRowVersion,
  });
  
  factory ChangeAiCredentialRequest.fromJson(Map<String, Object?> json) => _$ChangeAiCredentialRequestFromJson(json);
  
  final ChangeAiCredentialRequestAction action;
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$ChangeAiCredentialRequestToJson(this);
}
