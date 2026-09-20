// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'serial.dart';
import 'response_meta.dart';

part 'post_api_v1_chamber_days_id_walk_ins_response.g.dart';

@JsonSerializable()
class PostApiV1ChamberDaysIdWalkInsResponse {
  const PostApiV1ChamberDaysIdWalkInsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1ChamberDaysIdWalkInsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1ChamberDaysIdWalkInsResponseFromJson(json);
  
  final Serial data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1ChamberDaysIdWalkInsResponseToJson(this);
}
