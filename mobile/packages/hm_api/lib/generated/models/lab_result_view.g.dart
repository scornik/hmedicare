// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'lab_result_view.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

LabResultView _$LabResultViewFromJson(Map<String, dynamic> json) =>
    LabResultView(
      abnormalFlag: json['abnormalFlag'] == null
          ? null
          : LabResultViewAbnormalFlag.fromJson(json['abnormalFlag'] as String),
      analyteDisplay: json['analyteDisplay'] as String,
      id: json['id'] as String,
      referenceRange: json['referenceRange'] as String?,
      reviewStatus: LabResultViewReviewStatus.fromJson(
        json['reviewStatus'] as String,
      ),
      unit: json['unit'] as String?,
      valueNumeric: json['valueNumeric'] as String?,
      valueText: json['valueText'] as String?,
    );

Map<String, dynamic> _$LabResultViewToJson(LabResultView instance) =>
    <String, dynamic>{
      'abnormalFlag': ?instance.abnormalFlag,
      'analyteDisplay': instance.analyteDisplay,
      'id': instance.id,
      'referenceRange': ?instance.referenceRange,
      'reviewStatus': instance.reviewStatus,
      'unit': ?instance.unit,
      'valueNumeric': ?instance.valueNumeric,
      'valueText': ?instance.valueText,
    };
