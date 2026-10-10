// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'communication_channel.dart';
import 'communication_status.dart';

part 'communication_summary.g.dart';

@JsonSerializable()
class CommunicationSummary {
  const CommunicationSummary({
    required this.businessId,
    required this.businessType,
    required this.channel,
    required this.createdAt,
    required this.id,
    required this.purpose,
    required this.rowVersion,
    required this.status,
    required this.updatedAt,
  });
  
  factory CommunicationSummary.fromJson(Map<String, Object?> json) => _$CommunicationSummaryFromJson(json);
  
  final String businessId;
  final String businessType;
  final CommunicationChannel channel;
  final DateTime createdAt;
  final String id;
  final String purpose;
  final int rowVersion;
  final CommunicationStatus status;
  final DateTime updatedAt;

  Map<String, Object?> toJson() => _$CommunicationSummaryToJson(this);
}
