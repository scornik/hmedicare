// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'serial.dart';

part 'reschedule_serial_response.g.dart';

@JsonSerializable()
class RescheduleSerialResponse {
  const RescheduleSerialResponse({
    required this.next,
    required this.old,
  });
  
  factory RescheduleSerialResponse.fromJson(Map<String, Object?> json) => _$RescheduleSerialResponseFromJson(json);
  
  final Serial next;
  final Serial old;

  Map<String, Object?> toJson() => _$RescheduleSerialResponseToJson(this);
}
