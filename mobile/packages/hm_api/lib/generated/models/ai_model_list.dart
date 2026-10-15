// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_model.dart';

part 'ai_model_list.g.dart';

@JsonSerializable()
class AiModelList {
  const AiModelList({
    required this.items,
  });
  
  factory AiModelList.fromJson(Map<String, Object?> json) => _$AiModelListFromJson(json);
  
  final List<AiModel> items;

  Map<String, Object?> toJson() => _$AiModelListToJson(this);
}
