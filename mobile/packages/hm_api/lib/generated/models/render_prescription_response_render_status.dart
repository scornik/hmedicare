// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Stays AVAILABLE when a PDF already exists: a re-render must not take away the current copy
@JsonEnum()
enum RenderPrescriptionResponseRenderStatus {
  @JsonValue('NOT_REQUESTED')
  notRequested('NOT_REQUESTED'),
  @JsonValue('QUEUED')
  queued('QUEUED'),
  @JsonValue('RENDERING')
  rendering('RENDERING'),
  @JsonValue('AVAILABLE')
  available('AVAILABLE'),
  @JsonValue('FAILED')
  failed('FAILED'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const RenderPrescriptionResponseRenderStatus(this.json);

  factory RenderPrescriptionResponseRenderStatus.fromJson(String json) => values.firstWhere(
        (e) => e.json == json,
        orElse: () => $unknown,
      );

  final String? json;
  String toJson() {
    final value = json;
    if (value == null) {
      throw StateError('Cannot convert enum value with null JSON representation to String. '
          'This usually happens for \$unknown or @JsonValue(null) entries.');
    }
    return value as String;
  }

  @override
  String toString() => json?.toString() ?? super.toString();
  /// Returns all defined enum values excluding the $unknown value.
  static List<RenderPrescriptionResponseRenderStatus> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
