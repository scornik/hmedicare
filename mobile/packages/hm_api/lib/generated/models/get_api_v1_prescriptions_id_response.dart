// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'prescription.dart';
import 'response_meta.dart';

part 'get_api_v1_prescriptions_id_response.g.dart';

@JsonSerializable()
class GetApiV1PrescriptionsIdResponse {
  const GetApiV1PrescriptionsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1PrescriptionsIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1PrescriptionsIdResponseFromJson(json);
  
  final Prescription data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1PrescriptionsIdResponseToJson(this);
}
