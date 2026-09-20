// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'chamber_chamber_payment_mode.dart';
import 'chamber_status.dart';
import 'chamber_telemedicine_payment_mode.dart';
import 'queue_policy.dart';

part 'chamber.g.dart';

@JsonSerializable()
class Chamber {
  const Chamber({
    required this.chamberPaymentMode,
    required this.clinicId,
    required this.createdAt,
    required this.defaultQueuePolicy,
    required this.doctorDisplayName,
    required this.doctorProfileId,
    required this.id,
    required this.name,
    required this.rowVersion,
    required this.status,
    required this.supportsHybrid,
    required this.supportsPhysical,
    required this.supportsRemote,
    required this.telemedicinePaymentMode,
    required this.updatedAt,
  });
  
  factory Chamber.fromJson(Map<String, Object?> json) => _$ChamberFromJson(json);
  
  final ChamberChamberPaymentMode chamberPaymentMode;
  final String clinicId;
  final DateTime createdAt;
  final QueuePolicy defaultQueuePolicy;
  final String doctorDisplayName;
  final String doctorProfileId;
  final String id;
  final String name;
  final int rowVersion;
  final ChamberStatus status;
  final bool supportsHybrid;
  final bool supportsPhysical;
  final bool supportsRemote;
  final ChamberTelemedicinePaymentMode telemedicinePaymentMode;
  final DateTime updatedAt;

  Map<String, Object?> toJson() => _$ChamberToJson(this);
}
