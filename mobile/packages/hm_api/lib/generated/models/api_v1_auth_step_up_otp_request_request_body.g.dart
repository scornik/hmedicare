// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'api_v1_auth_step_up_otp_request_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApiV1AuthStepUpOtpRequestRequestBody
_$ApiV1AuthStepUpOtpRequestRequestBodyFromJson(Map<String, dynamic> json) =>
    ApiV1AuthStepUpOtpRequestRequestBody(
      locale: json['locale'] == null
          ? null
          : Locale.fromJson(json['locale'] as String),
    );

Map<String, dynamic> _$ApiV1AuthStepUpOtpRequestRequestBodyToJson(
  ApiV1AuthStepUpOtpRequestRequestBody instance,
) => <String, dynamic>{'locale': instance.locale};
