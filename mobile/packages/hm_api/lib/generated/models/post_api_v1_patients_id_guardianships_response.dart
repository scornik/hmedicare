// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'guardianship.dart';
import 'response_meta.dart';

part 'post_api_v1_patients_id_guardianships_response.g.dart';

@JsonSerializable()
class PostApiV1PatientsIdGuardianshipsResponse {
  const PostApiV1PatientsIdGuardianshipsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1PatientsIdGuardianshipsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1PatientsIdGuardianshipsResponseFromJson(json);
  
  final Guardianship data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1PatientsIdGuardianshipsResponseToJson(this);
}
