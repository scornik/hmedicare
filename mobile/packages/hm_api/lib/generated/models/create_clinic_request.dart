// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'create_clinic_request.g.dart';

@JsonSerializable()
class CreateClinicRequest {
  const CreateClinicRequest({
    required this.name,
    this.address,
    this.smsDisplayName,
  });
  
  factory CreateClinicRequest.fromJson(Map<String, Object?> json) => _$CreateClinicRequestFromJson(json);
  
  final Map<String, String>? address;
  final String name;
  final String? smsDisplayName;

  Map<String, Object?> toJson() => _$CreateClinicRequestToJson(this);
}
