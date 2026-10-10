// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum CommunicationStatus {
  @JsonValue('CREATED')
  created('CREATED'),
  @JsonValue('CONSENT_CHECKED')
  consentChecked('CONSENT_CHECKED'),
  @JsonValue('QUEUED')
  queued('QUEUED'),
  @JsonValue('SENDING')
  sending('SENDING'),
  @JsonValue('SENT')
  sent('SENT'),
  @JsonValue('DELIVERED')
  delivered('DELIVERED'),
  @JsonValue('READ')
  read('READ'),
  @JsonValue('FAILED')
  failed('FAILED'),
  @JsonValue('RETRY_SCHEDULED')
  retryScheduled('RETRY_SCHEDULED'),
  @JsonValue('CANCELLED')
  cancelled('CANCELLED'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const CommunicationStatus(this.json);

  factory CommunicationStatus.fromJson(String json) => values.firstWhere(
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
  static List<CommunicationStatus> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
