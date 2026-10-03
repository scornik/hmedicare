// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'catalog_item_snapshot.dart';

part 'prescription_item_input.g.dart';

@JsonSerializable()
class PrescriptionItemInput {
  const PrescriptionItemInput({
    required this.dose,
    required this.duration,
    required this.frequency,
    required this.isFreeText,
    required this.sequence,
    this.substitutionAllowed = true,
    this.catalogSnapshot,
    this.dosageForm,
    this.freeTextName,
    this.instructions,
    this.instructionsBn,
    this.medicationDatasetVersion,
    this.medicationId,
    this.quantity,
    this.route,
    this.strength,
    this.timing,
  });
  
  factory PrescriptionItemInput.fromJson(Map<String, Object?> json) => _$PrescriptionItemInputFromJson(json);
  
  final CatalogItemSnapshot? catalogSnapshot;
  final String? dosageForm;
  final String dose;
  final String duration;
  final String? freeTextName;
  final String frequency;
  final String? instructions;
  final String? instructionsBn;
  final bool isFreeText;
  final String? medicationDatasetVersion;
  final String? medicationId;
  final String? quantity;
  final String? route;
  final int sequence;
  final String? strength;
  final bool substitutionAllowed;
  final String? timing;

  Map<String, Object?> toJson() => _$PrescriptionItemInputToJson(this);
}
