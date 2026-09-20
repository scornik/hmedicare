// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'chamber.dart';
import 'response_meta.dart';

part 'get_api_v1_chambers_response.g.dart';

@JsonSerializable()
class GetApiV1ChambersResponse {
  const GetApiV1ChambersResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1ChambersResponse.fromJson(Map<String, Object?> json) => _$GetApiV1ChambersResponseFromJson(json);
  
  final List<Chamber> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1ChambersResponseToJson(this);
}
