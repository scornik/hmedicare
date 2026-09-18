// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_auth_step_up_otp_request_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AuthStepUpOtpRequestResponse
_$PostApiV1AuthStepUpOtpRequestResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1AuthStepUpOtpRequestResponse(
      data: OtpRequestResponse.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1AuthStepUpOtpRequestResponseToJson(
  PostApiV1AuthStepUpOtpRequestResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
