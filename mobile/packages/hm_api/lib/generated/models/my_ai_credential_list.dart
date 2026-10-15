// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_credential.dart';

part 'my_ai_credential_list.g.dart';

@JsonSerializable()
class MyAiCredentialList {
  const MyAiCredentialList({
    required this.doctorProfileId,
    required this.items,
  });
  
  factory MyAiCredentialList.fromJson(Map<String, Object?> json) => _$MyAiCredentialListFromJson(json);
  
  final String doctorProfileId;
  final List<AiCredential> items;

  Map<String, Object?> toJson() => _$MyAiCredentialListToJson(this);
}
