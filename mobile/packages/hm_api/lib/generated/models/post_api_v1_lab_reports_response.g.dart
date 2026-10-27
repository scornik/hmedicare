// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_lab_reports_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1LabReportsResponse _$PostApiV1LabReportsResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1LabReportsResponse(
  data: LabReportView.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1LabReportsResponseToJson(
  PostApiV1LabReportsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
