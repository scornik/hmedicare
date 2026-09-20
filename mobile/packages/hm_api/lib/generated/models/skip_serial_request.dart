// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'skip_serial_request.g.dart';

@JsonSerializable()
class SkipSerialRequest {
  const SkipSerialRequest({
    required this.expectedRowVersion,
    required this.reason,
  });
  
  factory SkipSerialRequest.fromJson(Map<String, Object?> json) => _$SkipSerialRequestFromJson(json);
  
  final int expectedRowVersion;
  final String reason;

  Map<String, Object?> toJson() => _$SkipSerialRequestToJson(this);
}
