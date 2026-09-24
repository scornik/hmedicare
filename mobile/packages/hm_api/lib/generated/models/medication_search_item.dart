// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'medication_search_item_tier.dart';
import 'source.dart';

part 'medication_search_item.g.dart';

@JsonSerializable()
class MedicationSearchItem {
  const MedicationSearchItem({
    required this.brandName,
    required this.brandNameBn,
    required this.dosageForm,
    required this.dosageFormUnmapped,
    required this.genericDisplay,
    required this.manufacturerDisplay,
    required this.matchedOn,
    required this.medicationId,
    required this.route,
    required this.source,
    required this.strengthText,
    required this.tenantUsageCount,
    required this.tier,
  });
  
  factory MedicationSearchItem.fromJson(Map<String, Object?> json) => _$MedicationSearchItemFromJson(json);
  
  final String brandName;
  final String? brandNameBn;
  final String dosageForm;

  /// The dataset could not map this form; the editor badges it rather than hiding it
  final bool dosageFormUnmapped;
  final String genericDisplay;
  final String manufacturerDisplay;

  /// The alias or generic name that produced the match, so a prescriber sees why
  final String? matchedOn;
  final String medicationId;
  final String? route;
  final Source source;
  final String? strengthText;
  final int tenantUsageCount;
  final MedicationSearchItemTier tier;

  Map<String, Object?> toJson() => _$MedicationSearchItemToJson(this);
}
