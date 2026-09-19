// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'patient_address.g.dart';

@JsonSerializable()
class PatientAddress {
  const PatientAddress({
    this.district,
    this.division,
    this.line1,
    this.line2,
    this.postcode,
    this.upazila,
  });
  
  factory PatientAddress.fromJson(Map<String, Object?> json) => _$PatientAddressFromJson(json);
  
  final String? district;
  final String? division;
  final String? line1;
  final String? line2;
  final String? postcode;
  final String? upazila;

  Map<String, Object?> toJson() => _$PatientAddressToJson(this);
}
