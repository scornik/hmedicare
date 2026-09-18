// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_auth_otp_request_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AuthOtpRequestResponse _$PostApiV1AuthOtpRequestResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1AuthOtpRequestResponse(
  data: OtpRequestResponse.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1AuthOtpRequestResponseToJson(
  PostApiV1AuthOtpRequestResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
