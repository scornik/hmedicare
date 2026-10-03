// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'prescription_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PrescriptionList _$PrescriptionListFromJson(Map<String, dynamic> json) =>
    PrescriptionList(
      items: (json['items'] as List<dynamic>)
          .map((e) => Prescription.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$PrescriptionListToJson(PrescriptionList instance) =>
    <String, dynamic>{'items': instance.items};
