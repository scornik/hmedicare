// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'cancel_appointment_request_reason.dart';

part 'cancel_appointment_request.g.dart';

@JsonSerializable()
class CancelAppointmentRequest {
  const CancelAppointmentRequest({
    required this.expectedRowVersion,
    required this.reason,
  });
  
  factory CancelAppointmentRequest.fromJson(Map<String, Object?> json) => _$CancelAppointmentRequestFromJson(json);
  
  final int expectedRowVersion;
  final CancelAppointmentRequestReason reason;

  Map<String, Object?> toJson() => _$CancelAppointmentRequestToJson(this);
}
