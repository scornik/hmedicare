// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'membership_summary_role.dart';

part 'membership_summary.g.dart';

@JsonSerializable()
class MembershipSummary {
  const MembershipSummary({
    required this.membershipId,
    required this.role,
    required this.tenantId,
    required this.tenantName,
  });
  
  factory MembershipSummary.fromJson(Map<String, Object?> json) => _$MembershipSummaryFromJson(json);
  
  final String membershipId;
  final MembershipSummaryRole role;
  final String tenantId;
  final String tenantName;

  Map<String, Object?> toJson() => _$MembershipSummaryToJson(this);
}
