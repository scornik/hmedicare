// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'prescription.dart';
import 'response_meta.dart';

part 'post_api_v1_prescriptions_id_approve_response.g.dart';

@JsonSerializable()
class PostApiV1PrescriptionsIdApproveResponse {
  const PostApiV1PrescriptionsIdApproveResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1PrescriptionsIdApproveResponse.fromJson(Map<String, Object?> json) => _$PostApiV1PrescriptionsIdApproveResponseFromJson(json);
  
  final Prescription data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1PrescriptionsIdApproveResponseToJson(this);
}
