// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_auth_otp_verify_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AuthOtpVerifyResponse _$PostApiV1AuthOtpVerifyResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1AuthOtpVerifyResponse(
  data: SessionResponse.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1AuthOtpVerifyResponseToJson(
  PostApiV1AuthOtpVerifyResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
