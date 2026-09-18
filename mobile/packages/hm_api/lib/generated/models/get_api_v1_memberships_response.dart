// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'membership.dart';
import 'response_meta.dart';

part 'get_api_v1_memberships_response.g.dart';

@JsonSerializable()
class GetApiV1MembershipsResponse {
  const GetApiV1MembershipsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1MembershipsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1MembershipsResponseFromJson(json);
  
  final List<Membership> data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1MembershipsResponseToJson(this);
}
