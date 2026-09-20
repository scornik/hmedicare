// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'serial.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Serial _$SerialFromJson(Map<String, dynamic> json) => Serial(
  id: json['id'] as String,
  serialNumber: (json['serialNumber'] as num).toInt(),
  status: json['status'] as String,
);

Map<String, dynamic> _$SerialToJson(Serial instance) => <String, dynamic>{
  'id': instance.id,
  'serialNumber': instance.serialNumber,
  'status': instance.status,
};
