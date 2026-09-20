// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'appointment_slot.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AppointmentSlot _$AppointmentSlotFromJson(Map<String, dynamic> json) =>
    AppointmentSlot(
      bookedCount: (json['bookedCount'] as num).toInt(),
      capacity: (json['capacity'] as num).toInt(),
      endsAt: DateTime.parse(json['endsAt'] as String),
      id: json['id'] as String,
      localLabel: json['localLabel'] as String,
      startsAt: DateTime.parse(json['startsAt'] as String),
      status: AppointmentSlotStatus.fromJson(json['status'] as String),
    );

Map<String, dynamic> _$AppointmentSlotToJson(AppointmentSlot instance) =>
    <String, dynamic>{
      'bookedCount': instance.bookedCount,
      'capacity': instance.capacity,
      'endsAt': instance.endsAt.toIso8601String(),
      'id': instance.id,
      'localLabel': instance.localLabel,
      'startsAt': instance.startsAt.toIso8601String(),
      'status': instance.status,
    };
