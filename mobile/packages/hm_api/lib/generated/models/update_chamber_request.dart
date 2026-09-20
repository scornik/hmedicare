// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'queue_policy_patch.dart';
import 'update_chamber_request_chamber_payment_mode.dart';
import 'update_chamber_request_status.dart';
import 'update_chamber_request_telemedicine_payment_mode.dart';

part 'update_chamber_request.g.dart';

@JsonSerializable()
class UpdateChamberRequest {
  const UpdateChamberRequest({
    required this.expectedRowVersion,
    this.chamberPaymentMode,
    this.defaultQueuePolicy,
    this.name,
    this.status,
    this.supportsHybrid,
    this.supportsPhysical,
    this.supportsRemote,
    this.telemedicinePaymentMode,
  });
  
  factory UpdateChamberRequest.fromJson(Map<String, Object?> json) => _$UpdateChamberRequestFromJson(json);
  
  final UpdateChamberRequestChamberPaymentMode? chamberPaymentMode;
  final QueuePolicyPatch? defaultQueuePolicy;
  final int expectedRowVersion;
  final String? name;
  final UpdateChamberRequestStatus? status;
  final bool? supportsHybrid;
  final bool? supportsPhysical;
  final bool? supportsRemote;
  final UpdateChamberRequestTelemedicinePaymentMode? telemedicinePaymentMode;

  Map<String, Object?> toJson() => _$UpdateChamberRequestToJson(this);
}
