// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'appointment.dart';

part 'appointment_list_response.g.dart';

@JsonSerializable()
class AppointmentListResponse {
  const AppointmentListResponse({
    required this.hasMore,
    required this.items,
    required this.nextCursor,
  });
  
  factory AppointmentListResponse.fromJson(Map<String, Object?> json) => _$AppointmentListResponseFromJson(json);
  
  final bool hasMore;
  final List<Appointment> items;
  final String? nextCursor;

  Map<String, Object?> toJson() => _$AppointmentListResponseToJson(this);
}
