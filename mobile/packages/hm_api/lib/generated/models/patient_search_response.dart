// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient_summary.dart';

part 'patient_search_response.g.dart';

@JsonSerializable()
class PatientSearchResponse {
  const PatientSearchResponse({
    required this.hasMore,
    required this.items,
    required this.nextCursor,
  });
  
  factory PatientSearchResponse.fromJson(Map<String, Object?> json) => _$PatientSearchResponseFromJson(json);
  
  final bool hasMore;
  final List<PatientSummary> items;
  final String? nextCursor;

  Map<String, Object?> toJson() => _$PatientSearchResponseToJson(this);
}
