// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'withdraw_consent_request.g.dart';

@JsonSerializable()
class WithdrawConsentRequest {
  const WithdrawConsentRequest({
    required this.expectedRowVersion,
  });
  
  factory WithdrawConsentRequest.fromJson(Map<String, Object?> json) => _$WithdrawConsentRequestFromJson(json);
  
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$WithdrawConsentRequestToJson(this);
}
