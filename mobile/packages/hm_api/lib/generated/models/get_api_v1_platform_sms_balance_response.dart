// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data3.dart';
import 'response_meta.dart';

part 'get_api_v1_platform_sms_balance_response.g.dart';

@JsonSerializable()
class GetApiV1PlatformSmsBalanceResponse {
  const GetApiV1PlatformSmsBalanceResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1PlatformSmsBalanceResponse.fromJson(Map<String, Object?> json) => _$GetApiV1PlatformSmsBalanceResponseFromJson(json);
  
  final Data3 data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1PlatformSmsBalanceResponseToJson(this);
}
