// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'chamber_day.dart';
import 'response_meta.dart';

part 'post_api_v1_chamber_days_id_open_response.g.dart';

@JsonSerializable()
class PostApiV1ChamberDaysIdOpenResponse {
  const PostApiV1ChamberDaysIdOpenResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1ChamberDaysIdOpenResponse.fromJson(Map<String, Object?> json) => _$PostApiV1ChamberDaysIdOpenResponseFromJson(json);
  
  final ChamberDay data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1ChamberDaysIdOpenResponseToJson(this);
}
