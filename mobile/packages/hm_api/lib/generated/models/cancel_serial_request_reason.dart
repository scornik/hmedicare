// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum CancelSerialRequestReason {
  @JsonValue('PATIENT_REQUEST')
  patientRequest('PATIENT_REQUEST'),
  @JsonValue('STAFF_REQUEST')
  staffRequest('STAFF_REQUEST'),
  @JsonValue('DOCTOR_UNAVAILABLE')
  doctorUnavailable('DOCTOR_UNAVAILABLE'),
  @JsonValue('DAY_CANCELLED')
  dayCancelled('DAY_CANCELLED'),
  @JsonValue('DAY_CLOSED')
  dayClosed('DAY_CLOSED'),
  @JsonValue('DUPLICATE')
  duplicate('DUPLICATE'),
  @JsonValue('RESCHEDULED')
  rescheduled('RESCHEDULED'),
  @JsonValue('NO_SHOW_POLICY')
  noShowPolicy('NO_SHOW_POLICY'),
  @JsonValue('PAYMENT_NOT_COMPLETED')
  paymentNotCompleted('PAYMENT_NOT_COMPLETED'),
  @JsonValue('OTHER')
  other('OTHER'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const CancelSerialRequestReason(this.json);

  factory CancelSerialRequestReason.fromJson(String json) => values.firstWhere(
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
  static List<CancelSerialRequestReason> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
