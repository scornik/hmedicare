// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'appointment.dart';
import 'response_meta.dart';

part 'get_api_v1_appointments_id_response.g.dart';

@JsonSerializable()
class GetApiV1AppointmentsIdResponse {
  const GetApiV1AppointmentsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1AppointmentsIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1AppointmentsIdResponseFromJson(json);
  
  final Appointment data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1AppointmentsIdResponseToJson(this);
}
