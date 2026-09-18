// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'locale.dart';

part 'api_v1_auth_step_up_otp_request_request_body.g.dart';

@JsonSerializable()
class ApiV1AuthStepUpOtpRequestRequestBody {
  const ApiV1AuthStepUpOtpRequestRequestBody({
    this.locale,
  });
  
  factory ApiV1AuthStepUpOtpRequestRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1AuthStepUpOtpRequestRequestBodyFromJson(json);
  
  final Locale? locale;

  Map<String, Object?> toJson() => _$ApiV1AuthStepUpOtpRequestRequestBodyToJson(this);
}
