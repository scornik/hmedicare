// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'create_chamber_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CreateChamberRequest _$CreateChamberRequestFromJson(
  Map<String, dynamic> json,
) => CreateChamberRequest(
  clinicId: json['clinicId'] as String,
  doctorProfileId: json['doctorProfileId'] as String,
  name: json['name'] as String,
  supportsHybrid: json['supportsHybrid'] as bool? ?? false,
  supportsPhysical: json['supportsPhysical'] as bool? ?? true,
  supportsRemote: json['supportsRemote'] as bool? ?? false,
  chamberPaymentMode: json['chamberPaymentMode'] == null
      ? null
      : CreateChamberRequestChamberPaymentMode.fromJson(
          json['chamberPaymentMode'] as String,
        ),
  defaultQueuePolicy: json['defaultQueuePolicy'] == null
      ? null
      : QueuePolicyPatch.fromJson(
          json['defaultQueuePolicy'] as Map<String, dynamic>,
        ),
  telemedicinePaymentMode: json['telemedicinePaymentMode'] == null
      ? null
      : CreateChamberRequestTelemedicinePaymentMode.fromJson(
          json['telemedicinePaymentMode'] as String,
        ),
);

Map<String, dynamic> _$CreateChamberRequestToJson(
  CreateChamberRequest instance,
) => <String, dynamic>{
  'chamberPaymentMode': ?instance.chamberPaymentMode,
  'clinicId': instance.clinicId,
  'defaultQueuePolicy': ?instance.defaultQueuePolicy,
  'doctorProfileId': instance.doctorProfileId,
  'name': instance.name,
  'supportsHybrid': instance.supportsHybrid,
  'supportsPhysical': instance.supportsPhysical,
  'supportsRemote': instance.supportsRemote,
  'telemedicinePaymentMode': ?instance.telemedicinePaymentMode,
};
