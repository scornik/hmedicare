// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient_context.dart';
import 'response_meta.dart';

part 'get_api_v1_me_patient_contexts_response.g.dart';

@JsonSerializable()
class GetApiV1MePatientContextsResponse {
  const GetApiV1MePatientContextsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1MePatientContextsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1MePatientContextsResponseFromJson(json);
  
  final List<PatientContext> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1MePatientContextsResponseToJson(this);
}
