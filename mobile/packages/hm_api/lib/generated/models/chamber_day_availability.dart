// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'appointment_slot.dart';
import 'chamber_day.dart';
import 'counts.dart';

part 'chamber_day_availability.g.dart';

@JsonSerializable()
class ChamberDayAvailability {
  const ChamberDayAvailability({
    required this.counts,
    required this.day,
    required this.remainingBookings,
    required this.slots,
  });
  
  factory ChamberDayAvailability.fromJson(Map<String, Object?> json) => _$ChamberDayAvailabilityFromJson(json);
  
  final Counts counts;
  final ChamberDay day;
  final int? remainingBookings;
  final List<AppointmentSlot> slots;

  Map<String, Object?> toJson() => _$ChamberDayAvailabilityToJson(this);
}
