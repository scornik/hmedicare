// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'create_clinic_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CreateClinicRequest _$CreateClinicRequestFromJson(Map<String, dynamic> json) =>
    CreateClinicRequest(
      name: json['name'] as String,
      address: (json['address'] as Map<String, dynamic>?)?.map(
        (k, e) => MapEntry(k, e as String),
      ),
      smsDisplayName: json['smsDisplayName'] as String?,
    );

Map<String, dynamic> _$CreateClinicRequestToJson(
  CreateClinicRequest instance,
) => <String, dynamic>{
  'address': ?instance.address,
  'name': instance.name,
  'smsDisplayName': ?instance.smsDisplayName,
};
