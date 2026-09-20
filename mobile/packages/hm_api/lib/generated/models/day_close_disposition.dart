// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'booked.dart';
import 'called.dart';
import 'checked_in.dart';
import 'confirmed.dart';
import 'skipped.dart';
import 'waiting.dart';

part 'day_close_disposition.g.dart';

@JsonSerializable()
class DayCloseDisposition {
  const DayCloseDisposition({
    required this.booked,
    required this.called,
    required this.checkedIn,
    required this.confirmed,
    required this.skipped,
    required this.waiting,
  });
  
  factory DayCloseDisposition.fromJson(Map<String, Object?> json) => _$DayCloseDispositionFromJson(json);
  
  @JsonKey(name: 'BOOKED')
  final Booked booked;
  @JsonKey(name: 'CALLED')
  final Called called;
  @JsonKey(name: 'CHECKED_IN')
  final CheckedIn checkedIn;
  @JsonKey(name: 'CONFIRMED')
  final Confirmed confirmed;
  @JsonKey(name: 'SKIPPED')
  final Skipped skipped;
  @JsonKey(name: 'WAITING')
  final Waiting waiting;

  Map<String, Object?> toJson() => _$DayCloseDispositionToJson(this);
}
