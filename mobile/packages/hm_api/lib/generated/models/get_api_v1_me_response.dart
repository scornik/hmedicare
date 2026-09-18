// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'me_response.dart';
import 'response_meta.dart';

part 'get_api_v1_me_response.g.dart';

@JsonSerializable()
class GetApiV1MeResponse {
  const GetApiV1MeResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1MeResponse.fromJson(Map<String, Object?> json) => _$GetApiV1MeResponseFromJson(json);
  
  final MeResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1MeResponseToJson(this);
}
