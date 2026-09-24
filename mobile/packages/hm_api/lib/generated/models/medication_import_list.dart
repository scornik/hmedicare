// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'medication_import.dart';

part 'medication_import_list.g.dart';

@JsonSerializable()
class MedicationImportList {
  const MedicationImportList({
    required this.items,
  });
  
  factory MedicationImportList.fromJson(Map<String, Object?> json) => _$MedicationImportListFromJson(json);
  
  final List<MedicationImport> items;

  Map<String, Object?> toJson() => _$MedicationImportListToJson(this);
}
