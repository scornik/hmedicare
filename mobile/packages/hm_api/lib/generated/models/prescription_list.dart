// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'prescription.dart';

part 'prescription_list.g.dart';

@JsonSerializable()
class PrescriptionList {
  const PrescriptionList({
    required this.items,
  });
  
  factory PrescriptionList.fromJson(Map<String, Object?> json) => _$PrescriptionListFromJson(json);
  
  final List<Prescription> items;

  Map<String, Object?> toJson() => _$PrescriptionListToJson(this);
}
