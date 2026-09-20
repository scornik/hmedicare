// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum SerialStatus {
  @JsonValue('BOOKED')
  booked('BOOKED'),
  @JsonValue('CONFIRMED')
  confirmed('CONFIRMED'),
  @JsonValue('CHECKED_IN')
  checkedIn('CHECKED_IN'),
  @JsonValue('WAITING')
  waiting('WAITING'),
  @JsonValue('CALLED')
  called('CALLED'),
  @JsonValue('IN_CONSULTATION')
  inConsultation('IN_CONSULTATION'),
  @JsonValue('COMPLETED')
  completed('COMPLETED'),
  @JsonValue('SKIPPED')
  skipped('SKIPPED'),
  @JsonValue('NO_SHOW')
  noShow('NO_SHOW'),
  @JsonValue('CANCELLED')
  cancelled('CANCELLED'),
  @JsonValue('RESCHEDULED')
  rescheduled('RESCHEDULED'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const SerialStatus(this.json);

  factory SerialStatus.fromJson(String json) => values.firstWhere(
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
  static List<SerialStatus> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
