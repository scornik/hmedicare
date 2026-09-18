// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'step_up_verify_request.g.dart';

@JsonSerializable()
class StepUpVerifyRequest {
  const StepUpVerifyRequest({
    required this.code,
  });
  
  factory StepUpVerifyRequest.fromJson(Map<String, Object?> json) => _$StepUpVerifyRequestFromJson(json);
  
  final String code;

  Map<String, Object?> toJson() => _$StepUpVerifyRequestToJson(this);
}
