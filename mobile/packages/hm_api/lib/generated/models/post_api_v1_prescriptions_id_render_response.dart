// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'render_prescription_response.dart';
import 'response_meta.dart';

part 'post_api_v1_prescriptions_id_render_response.g.dart';

@JsonSerializable()
class PostApiV1PrescriptionsIdRenderResponse {
  const PostApiV1PrescriptionsIdRenderResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1PrescriptionsIdRenderResponse.fromJson(Map<String, Object?> json) => _$PostApiV1PrescriptionsIdRenderResponseFromJson(json);
  
  final RenderPrescriptionResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1PrescriptionsIdRenderResponseToJson(this);
}
