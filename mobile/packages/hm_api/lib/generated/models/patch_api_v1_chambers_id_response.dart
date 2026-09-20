// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'chamber.dart';
import 'response_meta.dart';

part 'patch_api_v1_chambers_id_response.g.dart';

@JsonSerializable()
class PatchApiV1ChambersIdResponse {
  const PatchApiV1ChambersIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory PatchApiV1ChambersIdResponse.fromJson(Map<String, Object?> json) => _$PatchApiV1ChambersIdResponseFromJson(json);
  
  final Chamber data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PatchApiV1ChambersIdResponseToJson(this);
}
