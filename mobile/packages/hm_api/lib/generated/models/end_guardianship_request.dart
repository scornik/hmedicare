// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'end_guardianship_request.g.dart';

@JsonSerializable()
class EndGuardianshipRequest {
  const EndGuardianshipRequest({
    required this.expectedRowVersion,
    this.reason,
  });
  
  factory EndGuardianshipRequest.fromJson(Map<String, Object?> json) => _$EndGuardianshipRequestFromJson(json);
  
  final int expectedRowVersion;
  final String? reason;

  Map<String, Object?> toJson() => _$EndGuardianshipRequestToJson(this);
}
