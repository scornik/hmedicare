// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'client_kind.dart';

part 'otp_verify_request.g.dart';

@JsonSerializable()
class OtpVerifyRequest {
  const OtpVerifyRequest({
    required this.code,
    required this.phone,
    this.client,
    this.deviceLabel,
  });
  
  factory OtpVerifyRequest.fromJson(Map<String, Object?> json) => _$OtpVerifyRequestFromJson(json);
  
  final ClientKind? client;
  final String code;
  final String? deviceLabel;

  /// Bangladesh mobile number
  final String phone;

  Map<String, Object?> toJson() => _$OtpVerifyRequestToJson(this);
}
