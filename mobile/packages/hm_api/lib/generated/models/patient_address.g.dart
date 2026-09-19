// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patient_address.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatientAddress _$PatientAddressFromJson(Map<String, dynamic> json) =>
    PatientAddress(
      district: json['district'] as String?,
      division: json['division'] as String?,
      line1: json['line1'] as String?,
      line2: json['line2'] as String?,
      postcode: json['postcode'] as String?,
      upazila: json['upazila'] as String?,
    );

Map<String, dynamic> _$PatientAddressToJson(PatientAddress instance) =>
    <String, dynamic>{
      'district': ?instance.district,
      'division': ?instance.division,
      'line1': ?instance.line1,
      'line2': ?instance.line2,
      'postcode': ?instance.postcode,
      'upazila': ?instance.upazila,
    };
