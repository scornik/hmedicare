// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'serial.dart';
import 'response_meta.dart';

part 'post_api_v1_serials_id_recall_response.g.dart';

@JsonSerializable()
class PostApiV1SerialsIdRecallResponse {
  const PostApiV1SerialsIdRecallResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1SerialsIdRecallResponse.fromJson(Map<String, Object?> json) => _$PostApiV1SerialsIdRecallResponseFromJson(json);
  
  final Serial data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1SerialsIdRecallResponseToJson(this);
}
