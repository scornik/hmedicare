// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'render_prescription_response_render_status.dart';

part 'render_prescription_response.g.dart';

@JsonSerializable()
class RenderPrescriptionResponse {
  const RenderPrescriptionResponse({
    required this.documentId,
    required this.jobId,
    required this.renderStatus,
  });
  
  factory RenderPrescriptionResponse.fromJson(Map<String, Object?> json) => _$RenderPrescriptionResponseFromJson(json);
  
  /// The document a previous render produced, if any
  final String? documentId;
  final String jobId;

  /// Stays AVAILABLE when a PDF already exists: a re-render must not take away the current copy
  final RenderPrescriptionResponseRenderStatus renderStatus;

  Map<String, Object?> toJson() => _$RenderPrescriptionResponseToJson(this);
}
