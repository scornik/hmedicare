// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'render_prescription_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RenderPrescriptionResponse _$RenderPrescriptionResponseFromJson(
  Map<String, dynamic> json,
) => RenderPrescriptionResponse(
  documentId: json['documentId'] as String?,
  jobId: json['jobId'] as String,
  renderStatus: RenderPrescriptionResponseRenderStatus.fromJson(
    json['renderStatus'] as String,
  ),
);

Map<String, dynamic> _$RenderPrescriptionResponseToJson(
  RenderPrescriptionResponse instance,
) => <String, dynamic>{
  'documentId': ?instance.documentId,
  'jobId': instance.jobId,
  'renderStatus': instance.renderStatus,
};
