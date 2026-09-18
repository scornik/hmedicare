// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'otp_request_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OtpRequestRequest _$OtpRequestRequestFromJson(Map<String, dynamic> json) =>
    OtpRequestRequest(
      phone: json['phone'] as String,
      purpose: json['purpose'] == null
          ? OtpRequestRequestPurpose.login
          : OtpRequestRequestPurpose.fromJson(json['purpose'] as String),
      locale: json['locale'] == null
          ? null
          : Locale.fromJson(json['locale'] as String),
    );

Map<String, dynamic> _$OtpRequestRequestToJson(OtpRequestRequest instance) =>
    <String, dynamic>{
      'locale': instance.locale,
      'phone': instance.phone,
      'purpose': instance.purpose,
    };
