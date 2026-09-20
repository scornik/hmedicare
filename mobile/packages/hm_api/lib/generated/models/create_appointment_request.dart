// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'create_appointment_request_care_mode.dart';
import 'create_appointment_request_source.dart';

part 'create_appointment_request.g.dart';

@JsonSerializable()
class CreateAppointmentRequest {
  const CreateAppointmentRequest({
    required this.careMode,
    required this.chamberId,
    required this.localDate,
    required this.patientId,
    this.reason,
    this.slotId,
    this.source,
  });
  
  factory CreateAppointmentRequest.fromJson(Map<String, Object?> json) => _$CreateAppointmentRequestFromJson(json);
  
  final CreateAppointmentRequestCareMode careMode;
  final String chamberId;

  /// Calendar date (no time zone)
  final String localDate;
  final String patientId;
  final String? reason;
  final String? slotId;
  final CreateAppointmentRequestSource? source;

  Map<String, Object?> toJson() => _$CreateAppointmentRequestToJson(this);
}
