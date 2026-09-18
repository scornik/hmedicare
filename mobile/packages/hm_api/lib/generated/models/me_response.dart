// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'me_user.dart';
import 'membership_summary.dart';

part 'me_response.g.dart';

@JsonSerializable()
class MeResponse {
  const MeResponse({
    required this.memberships,
    required this.platformOperator,
    required this.user,
  });
  
  factory MeResponse.fromJson(Map<String, Object?> json) => _$MeResponseFromJson(json);
  
  final List<MembershipSummary> memberships;
  final bool platformOperator;
  final MeUser user;

  Map<String, Object?> toJson() => _$MeResponseToJson(this);
}
