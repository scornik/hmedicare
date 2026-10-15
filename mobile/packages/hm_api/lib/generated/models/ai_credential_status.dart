// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum AiCredentialStatus {
  @JsonValue('PENDING_VALIDATION')
  pendingValidation('PENDING_VALIDATION'),
  @JsonValue('ACTIVE')
  active('ACTIVE'),
  @JsonValue('INVALID')
  invalid('INVALID'),
  @JsonValue('QUOTA_EXHAUSTED')
  quotaExhausted('QUOTA_EXHAUSTED'),
  @JsonValue('DISABLED')
  disabled('DISABLED'),
  @JsonValue('REVOKED')
  revoked('REVOKED'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const AiCredentialStatus(this.json);

  factory AiCredentialStatus.fromJson(String json) => values.firstWhere(
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
  static List<AiCredentialStatus> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
