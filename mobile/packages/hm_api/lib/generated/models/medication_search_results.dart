// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'medication_search_item.dart';

part 'medication_search_results.g.dart';

@JsonSerializable()
class MedicationSearchResults {
  const MedicationSearchResults({
    required this.items,
  });
  
  factory MedicationSearchResults.fromJson(Map<String, Object?> json) => _$MedicationSearchResultsFromJson(json);
  
  final List<MedicationSearchItem> items;

  Map<String, Object?> toJson() => _$MedicationSearchResultsToJson(this);
}
