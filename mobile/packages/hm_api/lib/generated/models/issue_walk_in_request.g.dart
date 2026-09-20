// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'issue_walk_in_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

IssueWalkInRequest _$IssueWalkInRequestFromJson(Map<String, dynamic> json) =>
    IssueWalkInRequest(
      careMode: IssueWalkInRequestCareMode.fromJson(json['careMode'] as String),
      patientId: json['patientId'] as String,
      duplicateOverride: json['duplicateOverride'] == null
          ? null
          : DuplicateOverride.fromJson(
              json['duplicateOverride'] as Map<String, dynamic>,
            ),
    );

Map<String, dynamic> _$IssueWalkInRequestToJson(IssueWalkInRequest instance) =>
    <String, dynamic>{
      'careMode': instance.careMode,
      'duplicateOverride': ?instance.duplicateOverride,
      'patientId': instance.patientId,
    };
