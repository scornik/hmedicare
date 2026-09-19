// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum RequestGuardianshipRequestAuthorityScope {
  @JsonValue('VIEW_RECORDS')
  viewRecords('VIEW_RECORDS'),
  @JsonValue('BOOK_APPOINTMENTS')
  bookAppointments('BOOK_APPOINTMENTS'),
  @JsonValue('MANAGE_SERIALS')
  manageSerials('MANAGE_SERIALS'),
  @JsonValue('JOIN_TELEMEDICINE')
  joinTelemedicine('JOIN_TELEMEDICINE'),
  @JsonValue('UPLOAD_DOCUMENTS')
  uploadDocuments('UPLOAD_DOCUMENTS'),
  @JsonValue('MANAGE_COMMUNICATION_PREFERENCES')
  manageCommunicationPreferences('MANAGE_COMMUNICATION_PREFERENCES'),
  @JsonValue('GIVE_CONSENT')
  giveConsent('GIVE_CONSENT'),
  @JsonValue('MAKE_PAYMENTS')
  makePayments('MAKE_PAYMENTS'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const RequestGuardianshipRequestAuthorityScope(this.json);

  factory RequestGuardianshipRequestAuthorityScope.fromJson(String json) => values.firstWhere(
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
  static List<RequestGuardianshipRequestAuthorityScope> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
