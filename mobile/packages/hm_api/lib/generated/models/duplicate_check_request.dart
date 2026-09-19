// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'duplicate_check_request.g.dart';

@JsonSerializable()
class DuplicateCheckRequest {
  const DuplicateCheckRequest({
    required this.legalName,
    this.phones = const [],
    this.birthYear,
    this.dateOfBirth,
    this.excludePatientId,
    this.legalNameBn,
  });
  
  factory DuplicateCheckRequest.fromJson(Map<String, Object?> json) => _$DuplicateCheckRequestFromJson(json);
  
  final int? birthYear;

  /// Calendar date (no time zone)
  final String? dateOfBirth;
  final String? excludePatientId;
  final String legalName;
  final String? legalNameBn;
  final List<String> phones;

  Map<String, Object?> toJson() => _$DuplicateCheckRequestToJson(this);
}
