// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'appointment_slot_status.dart';

part 'appointment_slot.g.dart';

@JsonSerializable()
class AppointmentSlot {
  const AppointmentSlot({
    required this.bookedCount,
    required this.capacity,
    required this.endsAt,
    required this.id,
    required this.localLabel,
    required this.startsAt,
    required this.status,
  });
  
  factory AppointmentSlot.fromJson(Map<String, Object?> json) => _$AppointmentSlotFromJson(json);
  
  final int bookedCount;
  final int capacity;
  final DateTime endsAt;
  final String id;
  final String localLabel;
  final DateTime startsAt;
  final AppointmentSlotStatus status;

  Map<String, Object?> toJson() => _$AppointmentSlotToJson(this);
}
