// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'prescription_item_input.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PrescriptionItemInput _$PrescriptionItemInputFromJson(
  Map<String, dynamic> json,
) => PrescriptionItemInput(
  dose: json['dose'] as String,
  duration: json['duration'] as String,
  frequency: json['frequency'] as String,
  isFreeText: json['isFreeText'] as bool,
  sequence: (json['sequence'] as num).toInt(),
  substitutionAllowed: json['substitutionAllowed'] as bool? ?? true,
  catalogSnapshot: json['catalogSnapshot'] == null
      ? null
      : CatalogItemSnapshot.fromJson(
          json['catalogSnapshot'] as Map<String, dynamic>,
        ),
  dosageForm: json['dosageForm'] as String?,
  freeTextName: json['freeTextName'] as String?,
  instructions: json['instructions'] as String?,
  instructionsBn: json['instructionsBn'] as String?,
  medicationDatasetVersion: json['medicationDatasetVersion'] as String?,
  medicationId: json['medicationId'] as String?,
  quantity: json['quantity'] as String?,
  route: json['route'] as String?,
  strength: json['strength'] as String?,
  timing: json['timing'] as String?,
);

Map<String, dynamic> _$PrescriptionItemInputToJson(
  PrescriptionItemInput instance,
) => <String, dynamic>{
  'catalogSnapshot': ?instance.catalogSnapshot,
  'dosageForm': ?instance.dosageForm,
  'dose': instance.dose,
  'duration': instance.duration,
  'freeTextName': ?instance.freeTextName,
  'frequency': instance.frequency,
  'instructions': ?instance.instructions,
  'instructionsBn': ?instance.instructionsBn,
  'isFreeText': instance.isFreeText,
  'medicationDatasetVersion': ?instance.medicationDatasetVersion,
  'medicationId': ?instance.medicationId,
  'quantity': ?instance.quantity,
  'route': ?instance.route,
  'sequence': instance.sequence,
  'strength': ?instance.strength,
  'substitutionAllowed': instance.substitutionAllowed,
  'timing': ?instance.timing,
};
