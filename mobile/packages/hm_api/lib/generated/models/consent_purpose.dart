// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum ConsentPurpose {
  @JsonValue('care')
  care('care'),
  @JsonValue('in_app')
  inApp('in_app'),
  @JsonValue('sms')
  sms('sms'),
  @JsonValue('whatsapp')
  whatsapp('whatsapp'),
  @JsonValue('email')
  email('email'),
  @JsonValue('telemedicine')
  telemedicine('telemedicine'),
  @JsonValue('ai_assistance')
  aiAssistance('ai_assistance'),
  @JsonValue('research')
  research('research'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const ConsentPurpose(this.json);

  factory ConsentPurpose.fromJson(String json) => values.firstWhere(
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
  static List<ConsentPurpose> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
