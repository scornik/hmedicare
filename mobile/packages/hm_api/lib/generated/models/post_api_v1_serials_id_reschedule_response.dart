// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'reschedule_serial_response.dart';
import 'response_meta.dart';

part 'post_api_v1_serials_id_reschedule_response.g.dart';

@JsonSerializable()
class PostApiV1SerialsIdRescheduleResponse {
  const PostApiV1SerialsIdRescheduleResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1SerialsIdRescheduleResponse.fromJson(Map<String, Object?> json) => _$PostApiV1SerialsIdRescheduleResponseFromJson(json);
  
  final RescheduleSerialResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1SerialsIdRescheduleResponseToJson(this);
}
