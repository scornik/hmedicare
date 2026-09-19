// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'review_merge_case_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ReviewMergeCaseRequest _$ReviewMergeCaseRequestFromJson(
  Map<String, dynamic> json,
) => ReviewMergeCaseRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  reason: json['reason'] as String?,
);

Map<String, dynamic> _$ReviewMergeCaseRequestToJson(
  ReviewMergeCaseRequest instance,
) => <String, dynamic>{
  'expectedRowVersion': instance.expectedRowVersion,
  'reason': ?instance.reason,
};
