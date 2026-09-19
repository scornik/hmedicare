// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'consent.dart';
import 'response_meta.dart';

part 'post_api_v1_patients_id_consents_response.g.dart';

@JsonSerializable()
class PostApiV1PatientsIdConsentsResponse {
  const PostApiV1PatientsIdConsentsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1PatientsIdConsentsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1PatientsIdConsentsResponseFromJson(json);
  
  final Consent data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1PatientsIdConsentsResponseToJson(this);
}
