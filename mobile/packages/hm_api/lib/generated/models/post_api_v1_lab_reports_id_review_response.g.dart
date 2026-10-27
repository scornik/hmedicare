// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_lab_reports_id_review_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1LabReportsIdReviewResponse
_$PostApiV1LabReportsIdReviewResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1LabReportsIdReviewResponse(
      data: LabReportView.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1LabReportsIdReviewResponseToJson(
  PostApiV1LabReportsIdReviewResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
