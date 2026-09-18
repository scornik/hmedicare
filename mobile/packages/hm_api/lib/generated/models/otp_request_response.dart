// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'otp_request_response_hint.dart';

part 'otp_request_response.g.dart';

@JsonSerializable()
class OtpRequestResponse {
  const OtpRequestResponse({
    required this.challengeId,
    required this.expiresAt,
    required this.hint,
  });
  
  factory OtpRequestResponse.fromJson(Map<String, Object?> json) => _$OtpRequestResponseFromJson(json);
  
  final String challengeId;
  final DateTime expiresAt;

  /// SENT; RETRY_LATER (not delivered, request a new code later); MAY_ARRIVE (uncertain — never auto-resent)
  final OtpRequestResponseHint hint;

  Map<String, Object?> toJson() => _$OtpRequestResponseToJson(this);
}
