// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient_account.dart';

part 'patient_account_list_response.g.dart';

@JsonSerializable()
class PatientAccountListResponse {
  const PatientAccountListResponse({
    required this.hasMore,
    required this.items,
    required this.nextCursor,
  });
  
  factory PatientAccountListResponse.fromJson(Map<String, Object?> json) => _$PatientAccountListResponseFromJson(json);
  
  final bool hasMore;
  final List<PatientAccount> items;
  final String? nextCursor;

  Map<String, Object?> toJson() => _$PatientAccountListResponseToJson(this);
}
