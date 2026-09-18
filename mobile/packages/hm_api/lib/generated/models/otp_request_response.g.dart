// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'otp_request_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OtpRequestResponse _$OtpRequestResponseFromJson(Map<String, dynamic> json) =>
    OtpRequestResponse(
      challengeId: json['challengeId'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      hint: OtpRequestResponseHint.fromJson(json['hint'] as String),
    );

Map<String, dynamic> _$OtpRequestResponseToJson(OtpRequestResponse instance) =>
    <String, dynamic>{
      'challengeId': instance.challengeId,
      'expiresAt': instance.expiresAt.toIso8601String(),
      'hint': instance.hint,
    };
