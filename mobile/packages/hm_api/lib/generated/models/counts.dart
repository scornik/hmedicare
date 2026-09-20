// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'counts.g.dart';

@JsonSerializable()
class Counts {
  const Counts({
    required this.booked,
    required this.nonCancelled,
    required this.walkIns,
  });
  
  factory Counts.fromJson(Map<String, Object?> json) => _$CountsFromJson(json);
  
  final int booked;
  final int nonCancelled;
  final int walkIns;

  Map<String, Object?> toJson() => _$CountsToJson(this);
}
