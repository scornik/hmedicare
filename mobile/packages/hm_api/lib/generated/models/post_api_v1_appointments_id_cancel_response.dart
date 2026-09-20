// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'appointment.dart';
import 'response_meta.dart';

part 'post_api_v1_appointments_id_cancel_response.g.dart';

@JsonSerializable()
class PostApiV1AppointmentsIdCancelResponse {
  const PostApiV1AppointmentsIdCancelResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AppointmentsIdCancelResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AppointmentsIdCancelResponseFromJson(json);
  
  final Appointment data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AppointmentsIdCancelResponseToJson(this);
}
