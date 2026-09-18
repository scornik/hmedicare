// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'locale.dart';
import 'otp_request_request_purpose.dart';

part 'otp_request_request.g.dart';

@JsonSerializable()
class OtpRequestRequest {
  const OtpRequestRequest({
    required this.phone,
    this.purpose = OtpRequestRequestPurpose.login,
    this.locale,
  });
  
  factory OtpRequestRequest.fromJson(Map<String, Object?> json) => _$OtpRequestRequestFromJson(json);
  
  final Locale? locale;

  /// Bangladesh mobile number
  final String phone;
  final OtpRequestRequestPurpose purpose;

  Map<String, Object?> toJson() => _$OtpRequestRequestToJson(this);
}
