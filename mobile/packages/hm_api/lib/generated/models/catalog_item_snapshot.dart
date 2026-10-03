// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'catalog_item_snapshot.g.dart';

@JsonSerializable()
class CatalogItemSnapshot {
  const CatalogItemSnapshot({
    required this.brandName,
    required this.brandNameBn,
    required this.dgdaMatch,
    required this.dosageForm,
    required this.genericDisplay,
    required this.manufacturerDisplay,
    required this.reviewStatus,
    required this.strengthText,
  });
  
  factory CatalogItemSnapshot.fromJson(Map<String, Object?> json) => _$CatalogItemSnapshotFromJson(json);
  
  final String brandName;
  final String? brandNameBn;
  final String dgdaMatch;
  final String dosageForm;
  final String genericDisplay;
  final String manufacturerDisplay;
  final String reviewStatus;
  final String? strengthText;

  Map<String, Object?> toJson() => _$CatalogItemSnapshotToJson(this);
}
