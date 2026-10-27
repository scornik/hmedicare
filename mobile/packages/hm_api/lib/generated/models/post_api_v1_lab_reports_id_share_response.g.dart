// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_lab_reports_id_share_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1LabReportsIdShareResponse _$PostApiV1LabReportsIdShareResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1LabReportsIdShareResponse(
  data: LabReportView.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1LabReportsIdShareResponseToJson(
  PostApiV1LabReportsIdShareResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
