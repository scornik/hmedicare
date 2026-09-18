// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'membership.dart';
import 'response_meta.dart';

part 'patch_api_v1_memberships_id_response.g.dart';

@JsonSerializable()
class PatchApiV1MembershipsIdResponse {
  const PatchApiV1MembershipsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory PatchApiV1MembershipsIdResponse.fromJson(Map<String, Object?> json) => _$PatchApiV1MembershipsIdResponseFromJson(json);
  
  final Membership data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PatchApiV1MembershipsIdResponseToJson(this);
}
