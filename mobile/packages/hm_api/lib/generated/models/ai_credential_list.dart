// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_credential.dart';

part 'ai_credential_list.g.dart';

@JsonSerializable()
class AiCredentialList {
  const AiCredentialList({
    required this.items,
  });
  
  factory AiCredentialList.fromJson(Map<String, Object?> json) => _$AiCredentialListFromJson(json);
  
  final List<AiCredential> items;

  Map<String, Object?> toJson() => _$AiCredentialListToJson(this);
}
