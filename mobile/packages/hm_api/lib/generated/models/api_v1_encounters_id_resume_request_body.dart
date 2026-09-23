// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'api_v1_encounters_id_resume_request_body.g.dart';

@JsonSerializable()
class ApiV1EncountersIdResumeRequestBody {
  const ApiV1EncountersIdResumeRequestBody({
    required this.expectedRowVersion,
  });
  
  factory ApiV1EncountersIdResumeRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1EncountersIdResumeRequestBodyFromJson(json);
  
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$ApiV1EncountersIdResumeRequestBodyToJson(this);
}
