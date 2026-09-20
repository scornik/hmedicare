// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'update_clinic_request_status.dart';

part 'update_clinic_request.g.dart';

@JsonSerializable()
class UpdateClinicRequest {
  const UpdateClinicRequest({
    required this.expectedRowVersion,
    this.address,
    this.name,
    this.smsDisplayName,
    this.status,
  });
  
  factory UpdateClinicRequest.fromJson(Map<String, Object?> json) => _$UpdateClinicRequestFromJson(json);
  
  final Map<String, String>? address;
  final int expectedRowVersion;
  final String? name;
  final String? smsDisplayName;
  final UpdateClinicRequestStatus? status;

  Map<String, Object?> toJson() => _$UpdateClinicRequestToJson(this);
}
