// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'check_in_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CheckInRequest _$CheckInRequestFromJson(Map<String, dynamic> json) =>
    CheckInRequest(
      expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
      method: json['method'] == null
          ? null
          : CheckInRequestMethod.fromJson(json['method'] as String),
    );

Map<String, dynamic> _$CheckInRequestToJson(CheckInRequest instance) =>
    <String, dynamic>{
      'expectedRowVersion': instance.expectedRowVersion,
      'method': ?instance.method,
    };
