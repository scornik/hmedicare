// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'membership.dart';
import 'response_meta.dart';

part 'post_api_v1_memberships_response.g.dart';

@JsonSerializable()
class PostApiV1MembershipsResponse {
  const PostApiV1MembershipsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1MembershipsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1MembershipsResponseFromJson(json);
  
  final Membership data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1MembershipsResponseToJson(this);
}
