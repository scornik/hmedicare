// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'queue_snapshot.dart';
import 'response_meta.dart';

part 'post_api_v1_chamber_days_id_reorder_response.g.dart';

@JsonSerializable()
class PostApiV1ChamberDaysIdReorderResponse {
  const PostApiV1ChamberDaysIdReorderResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1ChamberDaysIdReorderResponse.fromJson(Map<String, Object?> json) => _$PostApiV1ChamberDaysIdReorderResponseFromJson(json);
  
  final QueueSnapshot data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1ChamberDaysIdReorderResponseToJson(this);
}
