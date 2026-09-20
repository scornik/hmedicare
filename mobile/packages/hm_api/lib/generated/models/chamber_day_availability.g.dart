// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'chamber_day_availability.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ChamberDayAvailability _$ChamberDayAvailabilityFromJson(
  Map<String, dynamic> json,
) => ChamberDayAvailability(
  counts: Counts.fromJson(json['counts'] as Map<String, dynamic>),
  day: ChamberDay.fromJson(json['day'] as Map<String, dynamic>),
  remainingBookings: (json['remainingBookings'] as num?)?.toInt(),
  slots: (json['slots'] as List<dynamic>)
      .map((e) => AppointmentSlot.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$ChamberDayAvailabilityToJson(
  ChamberDayAvailability instance,
) => <String, dynamic>{
  'counts': instance.counts,
  'day': instance.day,
  'remainingBookings': ?instance.remainingBookings,
  'slots': instance.slots,
};
