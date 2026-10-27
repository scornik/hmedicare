// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum AttestedSource {
  /// The name has been replaced because it contains a keyword. Original name: `true`.
  @JsonValue('true')
  valueTrue('true'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const AttestedSource(this.json);

  factory AttestedSource.fromJson(bool json) => values.firstWhere(
        (e) => e.json == json,
        orElse: () => $unknown,
      );

  final bool? json;
  bool toJson() {
    final value = json;
    if (value == null) {
      throw StateError('Cannot convert enum value with null JSON representation to bool. '
          'This usually happens for \$unknown or @JsonValue(null) entries.');
    }
    return value as bool;
  }

  @override
  String toString() => json?.toString() ?? super.toString();
  /// Returns all defined enum values excluding the $unknown value.
  static List<AttestedSource> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
