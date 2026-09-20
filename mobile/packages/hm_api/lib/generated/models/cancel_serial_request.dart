// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'cancel_serial_request_reason.dart';

part 'cancel_serial_request.g.dart';

@JsonSerializable()
class CancelSerialRequest {
  const CancelSerialRequest({
    required this.expectedRowVersion,
    required this.reason,
  });
  
  factory CancelSerialRequest.fromJson(Map<String, Object?> json) => _$CancelSerialRequestFromJson(json);
  
  final int expectedRowVersion;
  final CancelSerialRequestReason reason;

  Map<String, Object?> toJson() => _$CancelSerialRequestToJson(this);
}
