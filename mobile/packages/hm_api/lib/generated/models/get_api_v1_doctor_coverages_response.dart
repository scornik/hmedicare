// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'doctor_coverage.dart';
import 'response_meta.dart';

part 'get_api_v1_doctor_coverages_response.g.dart';

@JsonSerializable()
class GetApiV1DoctorCoveragesResponse {
  const GetApiV1DoctorCoveragesResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1DoctorCoveragesResponse.fromJson(Map<String, Object?> json) => _$GetApiV1DoctorCoveragesResponseFromJson(json);
  
  final List<DoctorCoverage> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1DoctorCoveragesResponseToJson(this);
}
