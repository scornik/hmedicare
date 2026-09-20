// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'update_chamber_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

UpdateChamberRequest _$UpdateChamberRequestFromJson(
  Map<String, dynamic> json,
) => UpdateChamberRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  chamberPaymentMode: json['chamberPaymentMode'] == null
      ? null
      : UpdateChamberRequestChamberPaymentMode.fromJson(
          json['chamberPaymentMode'] as String,
        ),
  defaultQueuePolicy: json['defaultQueuePolicy'] == null
      ? null
      : QueuePolicyPatch.fromJson(
          json['defaultQueuePolicy'] as Map<String, dynamic>,
        ),
  name: json['name'] as String?,
  status: json['status'] == null
      ? null
      : UpdateChamberRequestStatus.fromJson(json['status'] as String),
  supportsHybrid: json['supportsHybrid'] as bool?,
  supportsPhysical: json['supportsPhysical'] as bool?,
  supportsRemote: json['supportsRemote'] as bool?,
  telemedicinePaymentMode: json['telemedicinePaymentMode'] == null
      ? null
      : UpdateChamberRequestTelemedicinePaymentMode.fromJson(
          json['telemedicinePaymentMode'] as String,
        ),
);

Map<String, dynamic> _$UpdateChamberRequestToJson(
  UpdateChamberRequest instance,
) => <String, dynamic>{
  'chamberPaymentMode': ?instance.chamberPaymentMode,
  'defaultQueuePolicy': ?instance.defaultQueuePolicy,
  'expectedRowVersion': instance.expectedRowVersion,
  'name': ?instance.name,
  'status': ?instance.status,
  'supportsHybrid': ?instance.supportsHybrid,
  'supportsPhysical': ?instance.supportsPhysical,
  'supportsRemote': ?instance.supportsRemote,
  'telemedicinePaymentMode': ?instance.telemedicinePaymentMode,
};
