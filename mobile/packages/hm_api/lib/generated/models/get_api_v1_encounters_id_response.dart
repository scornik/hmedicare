// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encounter.dart';
import 'response_meta.dart';

part 'get_api_v1_encounters_id_response.g.dart';

@JsonSerializable()
class GetApiV1EncountersIdResponse {
  const GetApiV1EncountersIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1EncountersIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1EncountersIdResponseFromJson(json);
  
  final Encounter data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1EncountersIdResponseToJson(this);
}
