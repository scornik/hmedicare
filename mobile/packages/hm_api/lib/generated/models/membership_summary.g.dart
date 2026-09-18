// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'membership_summary.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MembershipSummary _$MembershipSummaryFromJson(Map<String, dynamic> json) =>
    MembershipSummary(
      membershipId: json['membershipId'] as String,
      role: MembershipSummaryRole.fromJson(json['role'] as String),
      tenantId: json['tenantId'] as String,
      tenantName: json['tenantName'] as String,
    );

Map<String, dynamic> _$MembershipSummaryToJson(MembershipSummary instance) =>
    <String, dynamic>{
      'membershipId': instance.membershipId,
      'role': instance.role,
      'tenantId': instance.tenantId,
      'tenantName': instance.tenantName,
    };
