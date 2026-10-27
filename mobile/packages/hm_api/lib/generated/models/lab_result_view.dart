// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'lab_result_view_abnormal_flag.dart';
import 'lab_result_view_review_status.dart';

part 'lab_result_view.g.dart';

@JsonSerializable()
class LabResultView {
  const LabResultView({
    required this.abnormalFlag,
    required this.analyteDisplay,
    required this.id,
    required this.referenceRange,
    required this.reviewStatus,
    required this.unit,
    required this.valueNumeric,
    required this.valueText,
  });
  
  factory LabResultView.fromJson(Map<String, Object?> json) => _$LabResultViewFromJson(json);
  
  final LabResultViewAbnormalFlag? abnormalFlag;
  final String analyteDisplay;
  final String id;
  final String? referenceRange;
  final LabResultViewReviewStatus reviewStatus;
  final String? unit;
  final String? valueNumeric;
  final String? valueText;

  Map<String, Object?> toJson() => _$LabResultViewToJson(this);
}
