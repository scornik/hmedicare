// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'otp_verify_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OtpVerifyRequest _$OtpVerifyRequestFromJson(Map<String, dynamic> json) =>
    OtpVerifyRequest(
      code: json['code'] as String,
      phone: json['phone'] as String,
      client: json['client'] == null
          ? null
          : ClientKind.fromJson(json['client'] as String),
      deviceLabel: json['deviceLabel'] as String?,
    );

Map<String, dynamic> _$OtpVerifyRequestToJson(OtpVerifyRequest instance) =>
    <String, dynamic>{
      'client': ?instance.client,
      'code': instance.code,
      'deviceLabel': ?instance.deviceLabel,
      'phone': instance.phone,
    };
