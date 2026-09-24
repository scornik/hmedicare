// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum GateCode {
  @JsonValue('LEGAL_SOURCE_REVIEW')
  legalSourceReview('LEGAL_SOURCE_REVIEW'),
  @JsonValue('CLINICAL_SAMPLE_REVIEW')
  clinicalSampleReview('CLINICAL_SAMPLE_REVIEW'),
  @JsonValue('DGDA_CROSS_REFERENCE')
  dgdaCrossReference('DGDA_CROSS_REFERENCE'),
  @JsonValue('IMPORT_SAFEGUARDS_VERIFIED')
  importSafeguardsVerified('IMPORT_SAFEGUARDS_VERIFIED'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const GateCode(this.json);

  factory GateCode.fromJson(String json) => values.firstWhere(
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
  static List<GateCode> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
