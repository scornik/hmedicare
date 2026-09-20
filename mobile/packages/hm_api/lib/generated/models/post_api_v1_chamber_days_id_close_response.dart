// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'chamber_day.dart';
import 'response_meta.dart';

part 'post_api_v1_chamber_days_id_close_response.g.dart';

@JsonSerializable()
class PostApiV1ChamberDaysIdCloseResponse {
  const PostApiV1ChamberDaysIdCloseResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1ChamberDaysIdCloseResponse.fromJson(Map<String, Object?> json) => _$PostApiV1ChamberDaysIdCloseResponseFromJson(json);
  
  final ChamberDay data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1ChamberDaysIdCloseResponseToJson(this);
}
