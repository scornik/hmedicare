// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'medication_search_item.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MedicationSearchItem _$MedicationSearchItemFromJson(
  Map<String, dynamic> json,
) => MedicationSearchItem(
  brandName: json['brandName'] as String,
  brandNameBn: json['brandNameBn'] as String?,
  dosageForm: json['dosageForm'] as String,
  dosageFormUnmapped: json['dosageFormUnmapped'] as bool,
  genericDisplay: json['genericDisplay'] as String,
  manufacturerDisplay: json['manufacturerDisplay'] as String,
  matchedOn: json['matchedOn'] as String?,
  medicationId: json['medicationId'] as String,
  route: json['route'] as String?,
  source: Source.fromJson(json['source'] as Map<String, dynamic>),
  strengthText: json['strengthText'] as String?,
  tenantUsageCount: (json['tenantUsageCount'] as num).toInt(),
  tier: MedicationSearchItemTier.fromJson(json['tier'] as String),
);

Map<String, dynamic> _$MedicationSearchItemToJson(
  MedicationSearchItem instance,
) => <String, dynamic>{
  'brandName': instance.brandName,
  'brandNameBn': ?instance.brandNameBn,
  'dosageForm': instance.dosageForm,
  'dosageFormUnmapped': instance.dosageFormUnmapped,
  'genericDisplay': instance.genericDisplay,
  'manufacturerDisplay': instance.manufacturerDisplay,
  'matchedOn': ?instance.matchedOn,
  'medicationId': instance.medicationId,
  'route': ?instance.route,
  'source': instance.source,
  'strengthText': ?instance.strengthText,
  'tenantUsageCount': instance.tenantUsageCount,
  'tier': instance.tier,
};
