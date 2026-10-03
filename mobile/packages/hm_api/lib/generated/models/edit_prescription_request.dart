// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'prescription_item_input.dart';

part 'edit_prescription_request.g.dart';

@JsonSerializable()
class EditPrescriptionRequest {
  const EditPrescriptionRequest({
    required this.expectedRowVersion,
    required this.items,
  });
  
  factory EditPrescriptionRequest.fromJson(Map<String, Object?> json) => _$EditPrescriptionRequestFromJson(json);
  
  final int expectedRowVersion;

  /// The whole list. A diff cannot tell "removed" from "not sent"
  final List<PrescriptionItemInput> items;

  Map<String, Object?> toJson() => _$EditPrescriptionRequestToJson(this);
}
