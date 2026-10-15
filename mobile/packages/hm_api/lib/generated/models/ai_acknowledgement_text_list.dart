// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_acknowledgement_text.dart';

part 'ai_acknowledgement_text_list.g.dart';

@JsonSerializable()
class AiAcknowledgementTextList {
  const AiAcknowledgementTextList({
    required this.items,
  });
  
  factory AiAcknowledgementTextList.fromJson(Map<String, Object?> json) => _$AiAcknowledgementTextListFromJson(json);
  
  final List<AiAcknowledgementText> items;

  Map<String, Object?> toJson() => _$AiAcknowledgementTextListToJson(this);
}
