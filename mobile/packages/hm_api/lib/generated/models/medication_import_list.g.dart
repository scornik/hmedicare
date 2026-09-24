// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'medication_import_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MedicationImportList _$MedicationImportListFromJson(
  Map<String, dynamic> json,
) => MedicationImportList(
  items: (json['items'] as List<dynamic>)
      .map((e) => MedicationImport.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$MedicationImportListToJson(
  MedicationImportList instance,
) => <String, dynamic>{'items': instance.items};
