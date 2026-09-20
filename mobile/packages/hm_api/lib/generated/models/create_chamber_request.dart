// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'create_chamber_request_chamber_payment_mode.dart';
import 'create_chamber_request_telemedicine_payment_mode.dart';
import 'queue_policy_patch.dart';

part 'create_chamber_request.g.dart';

@JsonSerializable()
class CreateChamberRequest {
  const CreateChamberRequest({
    required this.clinicId,
    required this.doctorProfileId,
    required this.name,
    this.supportsHybrid = false,
    this.supportsPhysical = true,
    this.supportsRemote = false,
    this.chamberPaymentMode,
    this.defaultQueuePolicy,
    this.telemedicinePaymentMode,
  });
  
  factory CreateChamberRequest.fromJson(Map<String, Object?> json) => _$CreateChamberRequestFromJson(json);
  
  final CreateChamberRequestChamberPaymentMode? chamberPaymentMode;
  final String clinicId;
  final QueuePolicyPatch? defaultQueuePolicy;
  final String doctorProfileId;
  final String name;
  final bool supportsHybrid;
  final bool supportsPhysical;
  final bool supportsRemote;
  final CreateChamberRequestTelemedicinePaymentMode? telemedicinePaymentMode;

  Map<String, Object?> toJson() => _$CreateChamberRequestToJson(this);
}
