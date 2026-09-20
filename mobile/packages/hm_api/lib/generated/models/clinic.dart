// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'clinic_status.dart';

part 'clinic.g.dart';

@JsonSerializable()
class Clinic {
  const Clinic({
    required this.address,
    required this.createdAt,
    required this.id,
    required this.name,
    required this.rowVersion,
    required this.smsDisplayName,
    required this.status,
    required this.updatedAt,
  });
  
  factory Clinic.fromJson(Map<String, Object?> json) => _$ClinicFromJson(json);
  
  final Map<String, String>? address;
  final DateTime createdAt;
  final String id;
  final String name;
  final int rowVersion;
  final String? smsDisplayName;
  final ClinicStatus status;
  final DateTime updatedAt;

  Map<String, Object?> toJson() => _$ClinicToJson(this);
}
