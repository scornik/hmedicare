// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'appointment_list_response.dart';
import 'response_meta.dart';

part 'get_api_v1_me_appointments_response.g.dart';

@JsonSerializable()
class GetApiV1MeAppointmentsResponse {
  const GetApiV1MeAppointmentsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1MeAppointmentsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1MeAppointmentsResponseFromJson(json);
  
  final AppointmentListResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1MeAppointmentsResponseToJson(this);
}
