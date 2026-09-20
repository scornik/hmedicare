// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'call_serial_request.g.dart';

@JsonSerializable()
class CallSerialRequest {
  const CallSerialRequest({
    required this.expectedRowVersion,
    this.overrideReason,
  });
  
  factory CallSerialRequest.fromJson(Map<String, Object?> json) => _$CallSerialRequestFromJson(json);
  
  final int expectedRowVersion;
  final String? overrideReason;

  Map<String, Object?> toJson() => _$CallSerialRequestToJson(this);
}
