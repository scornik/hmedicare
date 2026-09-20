// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'chamber.dart';
import 'response_meta.dart';

part 'post_api_v1_chambers_response.g.dart';

@JsonSerializable()
class PostApiV1ChambersResponse {
  const PostApiV1ChambersResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1ChambersResponse.fromJson(Map<String, Object?> json) => _$PostApiV1ChambersResponseFromJson(json);
  
  final Chamber data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1ChambersResponseToJson(this);
}
