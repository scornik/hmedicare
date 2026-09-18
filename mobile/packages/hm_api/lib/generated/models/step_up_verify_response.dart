// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'step_up_verify_response_authn_methods.dart';

part 'step_up_verify_response.g.dart';

@JsonSerializable()
class StepUpVerifyResponse {
  const StepUpVerifyResponse({
    required this.authnMethods,
  });
  
  factory StepUpVerifyResponse.fromJson(Map<String, Object?> json) => _$StepUpVerifyResponseFromJson(json);
  
  final List<StepUpVerifyResponseAuthnMethods> authnMethods;

  Map<String, Object?> toJson() => _$StepUpVerifyResponseToJson(this);
}
