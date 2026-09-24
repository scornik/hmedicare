// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum MedicationSearchItemTier {
  @JsonValue('EXACT_BRAND')
  exactBrand('EXACT_BRAND'),
  @JsonValue('BRAND_PREFIX')
  brandPrefix('BRAND_PREFIX'),
  @JsonValue('BRAND_BN_PREFIX')
  brandBnPrefix('BRAND_BN_PREFIX'),
  @JsonValue('SOURCE_ALIAS')
  sourceAlias('SOURCE_ALIAS'),
  @JsonValue('GENERIC_PREFIX')
  genericPrefix('GENERIC_PREFIX'),
  @JsonValue('GENERATED_ALIAS')
  generatedAlias('GENERATED_ALIAS'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const MedicationSearchItemTier(this.json);

  factory MedicationSearchItemTier.fromJson(String json) => values.firstWhere(
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
  static List<MedicationSearchItemTier> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
