// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'appointment_list_response.dart';
import 'response_meta.dart';

part 'get_api_v1_appointments_response.g.dart';

@JsonSerializable()
class GetApiV1AppointmentsResponse {
  const GetApiV1AppointmentsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1AppointmentsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1AppointmentsResponseFromJson(json);
  
  final AppointmentListResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1AppointmentsResponseToJson(this);
}
