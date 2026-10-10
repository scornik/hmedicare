// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'communication_summary.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CommunicationSummary _$CommunicationSummaryFromJson(
  Map<String, dynamic> json,
) => CommunicationSummary(
  businessId: json['businessId'] as String,
  businessType: json['businessType'] as String,
  channel: CommunicationChannel.fromJson(json['channel'] as String),
  createdAt: DateTime.parse(json['createdAt'] as String),
  id: json['id'] as String,
  purpose: json['purpose'] as String,
  rowVersion: (json['rowVersion'] as num).toInt(),
  status: CommunicationStatus.fromJson(json['status'] as String),
  updatedAt: DateTime.parse(json['updatedAt'] as String),
);

Map<String, dynamic> _$CommunicationSummaryToJson(
  CommunicationSummary instance,
) => <String, dynamic>{
  'businessId': instance.businessId,
  'businessType': instance.businessType,
  'channel': instance.channel,
  'createdAt': instance.createdAt.toIso8601String(),
  'id': instance.id,
  'purpose': instance.purpose,
  'rowVersion': instance.rowVersion,
  'status': instance.status,
  'updatedAt': instance.updatedAt.toIso8601String(),
};
