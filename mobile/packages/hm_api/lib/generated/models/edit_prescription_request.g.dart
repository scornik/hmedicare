// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edit_prescription_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EditPrescriptionRequest _$EditPrescriptionRequestFromJson(
  Map<String, dynamic> json,
) => EditPrescriptionRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  items: (json['items'] as List<dynamic>)
      .map((e) => PrescriptionItemInput.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$EditPrescriptionRequestToJson(
  EditPrescriptionRequest instance,
) => <String, dynamic>{
  'expectedRowVersion': instance.expectedRowVersion,
  'items': instance.items,
};
