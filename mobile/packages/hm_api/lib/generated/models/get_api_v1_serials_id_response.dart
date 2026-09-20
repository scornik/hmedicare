// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'serial.dart';
import 'response_meta.dart';

part 'get_api_v1_serials_id_response.g.dart';

@JsonSerializable()
class GetApiV1SerialsIdResponse {
  const GetApiV1SerialsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1SerialsIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1SerialsIdResponseFromJson(json);
  
  final Serial data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1SerialsIdResponseToJson(this);
}
