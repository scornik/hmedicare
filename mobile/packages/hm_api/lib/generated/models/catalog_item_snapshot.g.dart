// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_item_snapshot.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CatalogItemSnapshot _$CatalogItemSnapshotFromJson(Map<String, dynamic> json) =>
    CatalogItemSnapshot(
      brandName: json['brandName'] as String,
      brandNameBn: json['brandNameBn'] as String?,
      dgdaMatch: json['dgdaMatch'] as String,
      dosageForm: json['dosageForm'] as String,
      genericDisplay: json['genericDisplay'] as String,
      manufacturerDisplay: json['manufacturerDisplay'] as String,
      reviewStatus: json['reviewStatus'] as String,
      strengthText: json['strengthText'] as String?,
    );

Map<String, dynamic> _$CatalogItemSnapshotToJson(
  CatalogItemSnapshot instance,
) => <String, dynamic>{
  'brandName': instance.brandName,
  'brandNameBn': ?instance.brandNameBn,
  'dgdaMatch': instance.dgdaMatch,
  'dosageForm': instance.dosageForm,
  'genericDisplay': instance.genericDisplay,
  'manufacturerDisplay': instance.manufacturerDisplay,
  'reviewStatus': instance.reviewStatus,
  'strengthText': ?instance.strengthText,
};
