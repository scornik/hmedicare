// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'error_code.dart';
import 'field_error.dart';

part 'problem_details.g.dart';

/// Error body for every non-2xx response (API-IMPLEMENTATION §1)
@JsonSerializable()
class ProblemDetails {
  const ProblemDetails({
    required this.code,
    required this.message,
    required this.requestId,
    this.details,
    this.fieldErrors,
    this.retryAfterSeconds,
  });
  
  factory ProblemDetails.fromJson(Map<String, Object?> json) => _$ProblemDetailsFromJson(json);
  
  final ErrorCode code;
  final Map<String, dynamic>? details;
  final List<FieldError>? fieldErrors;

  /// Safe, localizable message key (never PHI)
  final String message;
  final String requestId;
  final int? retryAfterSeconds;

  Map<String, Object?> toJson() => _$ProblemDetailsToJson(this);
}
