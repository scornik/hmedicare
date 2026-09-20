// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'chamber.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Chamber _$ChamberFromJson(Map<String, dynamic> json) => Chamber(
  chamberPaymentMode: ChamberChamberPaymentMode.fromJson(
    json['chamberPaymentMode'] as String,
  ),
  clinicId: json['clinicId'] as String,
  createdAt: DateTime.parse(json['createdAt'] as String),
  defaultQueuePolicy: QueuePolicy.fromJson(
    json['defaultQueuePolicy'] as Map<String, dynamic>,
  ),
  doctorDisplayName: json['doctorDisplayName'] as String,
  doctorProfileId: json['doctorProfileId'] as String,
  id: json['id'] as String,
  name: json['name'] as String,
  rowVersion: (json['rowVersion'] as num).toInt(),
  status: ChamberStatus.fromJson(json['status'] as String),
  supportsHybrid: json['supportsHybrid'] as bool,
  supportsPhysical: json['supportsPhysical'] as bool,
  supportsRemote: json['supportsRemote'] as bool,
  telemedicinePaymentMode: ChamberTelemedicinePaymentMode.fromJson(
    json['telemedicinePaymentMode'] as String,
  ),
  updatedAt: DateTime.parse(json['updatedAt'] as String),
);

Map<String, dynamic> _$ChamberToJson(Chamber instance) => <String, dynamic>{
  'chamberPaymentMode': instance.chamberPaymentMode,
  'clinicId': instance.clinicId,
  'createdAt': instance.createdAt.toIso8601String(),
  'defaultQueuePolicy': instance.defaultQueuePolicy,
  'doctorDisplayName': instance.doctorDisplayName,
  'doctorProfileId': instance.doctorProfileId,
  'id': instance.id,
  'name': instance.name,
  'rowVersion': instance.rowVersion,
  'status': instance.status,
  'supportsHybrid': instance.supportsHybrid,
  'supportsPhysical': instance.supportsPhysical,
  'supportsRemote': instance.supportsRemote,
  'telemedicinePaymentMode': instance.telemedicinePaymentMode,
  'updatedAt': instance.updatedAt.toIso8601String(),
};
