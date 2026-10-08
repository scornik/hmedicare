// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'appointment.dart';
import 'response_meta.dart';

part 'post_api_v1_follow_ups_id_book_response.g.dart';

@JsonSerializable()
class PostApiV1FollowUpsIdBookResponse {
  const PostApiV1FollowUpsIdBookResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1FollowUpsIdBookResponse.fromJson(Map<String, Object?> json) => _$PostApiV1FollowUpsIdBookResponseFromJson(json);
  
  final Appointment data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1FollowUpsIdBookResponseToJson(this);
}
