// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'api_v1_encounters_id_complete_request_body.g.dart';

@JsonSerializable()
class ApiV1EncountersIdCompleteRequestBody {
  const ApiV1EncountersIdCompleteRequestBody({
    required this.expectedRowVersion,
  });
  
  factory ApiV1EncountersIdCompleteRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1EncountersIdCompleteRequestBodyFromJson(json);
  
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$ApiV1EncountersIdCompleteRequestBodyToJson(this);
}
