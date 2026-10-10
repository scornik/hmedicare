// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'telemedicine_session.dart';
import 'response_meta.dart';

part 'post_api_v1_encounters_id_telemedicine_session_response.g.dart';

@JsonSerializable()
class PostApiV1EncountersIdTelemedicineSessionResponse {
  const PostApiV1EncountersIdTelemedicineSessionResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1EncountersIdTelemedicineSessionResponse.fromJson(Map<String, Object?> json) => _$PostApiV1EncountersIdTelemedicineSessionResponseFromJson(json);
  
  final TelemedicineSession data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1EncountersIdTelemedicineSessionResponseToJson(this);
}
