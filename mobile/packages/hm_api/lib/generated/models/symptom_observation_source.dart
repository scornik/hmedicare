// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum SymptomObservationSource {
  @JsonValue('PATIENT_REPORTED')
  patientReported('PATIENT_REPORTED'),
  @JsonValue('CLINICIAN_OBSERVED')
  clinicianObserved('CLINICIAN_OBSERVED'),
  @JsonValue('AI_APPROVED')
  aiApproved('AI_APPROVED'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const SymptomObservationSource(this.json);

  factory SymptomObservationSource.fromJson(String json) => values.firstWhere(
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
  static List<SymptomObservationSource> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
