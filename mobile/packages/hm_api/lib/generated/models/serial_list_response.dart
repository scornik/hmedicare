// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient_serial_view.dart';

part 'serial_list_response.g.dart';

@JsonSerializable()
class SerialListResponse {
  const SerialListResponse({
    required this.items,
  });
  
  factory SerialListResponse.fromJson(Map<String, Object?> json) => _$SerialListResponseFromJson(json);
  
  final List<PatientSerialView> items;

  Map<String, Object?> toJson() => _$SerialListResponseToJson(this);
}
