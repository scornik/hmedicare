// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_auth_step_up_otp_verify_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AuthStepUpOtpVerifyResponse
_$PostApiV1AuthStepUpOtpVerifyResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1AuthStepUpOtpVerifyResponse(
      data: StepUpVerifyResponse.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1AuthStepUpOtpVerifyResponseToJson(
  PostApiV1AuthStepUpOtpVerifyResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
