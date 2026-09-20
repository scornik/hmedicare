// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'update_clinic_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

UpdateClinicRequest _$UpdateClinicRequestFromJson(Map<String, dynamic> json) =>
    UpdateClinicRequest(
      expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
      address: (json['address'] as Map<String, dynamic>?)?.map(
        (k, e) => MapEntry(k, e as String),
      ),
      name: json['name'] as String?,
      smsDisplayName: json['smsDisplayName'] as String?,
      status: json['status'] == null
          ? null
          : UpdateClinicRequestStatus.fromJson(json['status'] as String),
    );

Map<String, dynamic> _$UpdateClinicRequestToJson(
  UpdateClinicRequest instance,
) => <String, dynamic>{
  'address': ?instance.address,
  'expectedRowVersion': instance.expectedRowVersion,
  'name': ?instance.name,
  'smsDisplayName': ?instance.smsDisplayName,
  'status': ?instance.status,
};
