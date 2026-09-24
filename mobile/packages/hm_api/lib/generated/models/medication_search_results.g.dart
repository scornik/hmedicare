// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'medication_search_results.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MedicationSearchResults _$MedicationSearchResultsFromJson(
  Map<String, dynamic> json,
) => MedicationSearchResults(
  items: (json['items'] as List<dynamic>)
      .map((e) => MedicationSearchItem.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$MedicationSearchResultsToJson(
  MedicationSearchResults instance,
) => <String, dynamic>{'items': instance.items};
