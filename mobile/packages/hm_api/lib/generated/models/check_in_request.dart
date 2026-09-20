// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'check_in_request_method.dart';

part 'check_in_request.g.dart';

@JsonSerializable()
class CheckInRequest {
  const CheckInRequest({
    required this.expectedRowVersion,
    this.method,
  });
  
  factory CheckInRequest.fromJson(Map<String, Object?> json) => _$CheckInRequestFromJson(json);
  
  final int expectedRowVersion;
  final CheckInRequestMethod? method;

  Map<String, Object?> toJson() => _$CheckInRequestToJson(this);
}
