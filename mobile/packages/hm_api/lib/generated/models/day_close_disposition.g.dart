// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'day_close_disposition.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DayCloseDisposition _$DayCloseDispositionFromJson(Map<String, dynamic> json) =>
    DayCloseDisposition(
      booked: Booked.fromJson(json['BOOKED'] as String),
      called: Called.fromJson(json['CALLED'] as String),
      checkedIn: CheckedIn.fromJson(json['CHECKED_IN'] as String),
      confirmed: Confirmed.fromJson(json['CONFIRMED'] as String),
      skipped: Skipped.fromJson(json['SKIPPED'] as String),
      waiting: Waiting.fromJson(json['WAITING'] as String),
    );

Map<String, dynamic> _$DayCloseDispositionToJson(
  DayCloseDisposition instance,
) => <String, dynamic>{
  'BOOKED': instance.booked,
  'CALLED': instance.called,
  'CHECKED_IN': instance.checkedIn,
  'CONFIRMED': instance.confirmed,
  'SKIPPED': instance.skipped,
  'WAITING': instance.waiting,
};
