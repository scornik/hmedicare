// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_model_list.dart';
import 'response_meta.dart';

part 'get_api_v1_ai_models_response.g.dart';

@JsonSerializable()
class GetApiV1AiModelsResponse {
  const GetApiV1AiModelsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1AiModelsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1AiModelsResponseFromJson(json);
  
  final AiModelList data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1AiModelsResponseToJson(this);
}
