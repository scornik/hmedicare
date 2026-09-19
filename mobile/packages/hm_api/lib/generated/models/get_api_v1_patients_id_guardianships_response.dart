// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'guardianship.dart';
import 'response_meta.dart';

part 'get_api_v1_patients_id_guardianships_response.g.dart';

@JsonSerializable()
class GetApiV1PatientsIdGuardianshipsResponse {
  const GetApiV1PatientsIdGuardianshipsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1PatientsIdGuardianshipsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1PatientsIdGuardianshipsResponseFromJson(json);
  
  final List<Guardianship> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1PatientsIdGuardianshipsResponseToJson(this);
}
