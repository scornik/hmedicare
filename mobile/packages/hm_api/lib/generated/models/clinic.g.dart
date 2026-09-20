// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'clinic.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Clinic _$ClinicFromJson(Map<String, dynamic> json) => Clinic(
  address: (json['address'] as Map<String, dynamic>?)?.map(
    (k, e) => MapEntry(k, e as String),
  ),
  createdAt: DateTime.parse(json['createdAt'] as String),
  id: json['id'] as String,
  name: json['name'] as String,
  rowVersion: (json['rowVersion'] as num).toInt(),
  smsDisplayName: json['smsDisplayName'] as String?,
  status: ClinicStatus.fromJson(json['status'] as String),
  updatedAt: DateTime.parse(json['updatedAt'] as String),
);

Map<String, dynamic> _$ClinicToJson(Clinic instance) => <String, dynamic>{
  'address': ?instance.address,
  'createdAt': instance.createdAt.toIso8601String(),
  'id': instance.id,
  'name': instance.name,
  'rowVersion': instance.rowVersion,
  'smsDisplayName': ?instance.smsDisplayName,
  'status': instance.status,
  'updatedAt': instance.updatedAt.toIso8601String(),
};
