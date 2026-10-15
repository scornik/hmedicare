// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_acknowledgement.dart';

part 'ai_acknowledgement_list.g.dart';

@JsonSerializable()
class AiAcknowledgementList {
  const AiAcknowledgementList({
    required this.items,
  });
  
  factory AiAcknowledgementList.fromJson(Map<String, Object?> json) => _$AiAcknowledgementListFromJson(json);
  
  final List<AiAcknowledgement> items;

  Map<String, Object?> toJson() => _$AiAcknowledgementListToJson(this);
}
