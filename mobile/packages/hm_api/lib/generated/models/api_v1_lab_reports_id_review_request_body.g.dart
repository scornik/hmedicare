// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'api_v1_lab_reports_id_review_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApiV1LabReportsIdReviewRequestBody _$ApiV1LabReportsIdReviewRequestBodyFromJson(
  Map<String, dynamic> json,
) => ApiV1LabReportsIdReviewRequestBody(
  attestedSource: json['attestedSource'] as bool,
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
);

Map<String, dynamic> _$ApiV1LabReportsIdReviewRequestBodyToJson(
  ApiV1LabReportsIdReviewRequestBody instance,
) => <String, dynamic>{
  'attestedSource': instance.attestedSource,
  'expectedRowVersion': instance.expectedRowVersion,
};
