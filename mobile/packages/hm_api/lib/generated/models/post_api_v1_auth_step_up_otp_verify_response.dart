// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'step_up_verify_response.dart';
import 'response_meta.dart';

part 'post_api_v1_auth_step_up_otp_verify_response.g.dart';

@JsonSerializable()
class PostApiV1AuthStepUpOtpVerifyResponse {
  const PostApiV1AuthStepUpOtpVerifyResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1AuthStepUpOtpVerifyResponse.fromJson(Map<String, Object?> json) => _$PostApiV1AuthStepUpOtpVerifyResponseFromJson(json);
  
  final StepUpVerifyResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1AuthStepUpOtpVerifyResponseToJson(this);
}
