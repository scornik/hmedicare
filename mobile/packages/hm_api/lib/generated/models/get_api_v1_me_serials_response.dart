// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'serial_list_response.dart';
import 'response_meta.dart';

part 'get_api_v1_me_serials_response.g.dart';

@JsonSerializable()
class GetApiV1MeSerialsResponse {
  const GetApiV1MeSerialsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1MeSerialsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1MeSerialsResponseFromJson(json);
  
  final SerialListResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1MeSerialsResponseToJson(this);
}
