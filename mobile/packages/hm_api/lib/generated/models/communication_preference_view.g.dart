// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'communication_preference_view.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CommunicationPreferenceView _$CommunicationPreferenceViewFromJson(
  Map<String, dynamic> json,
) => CommunicationPreferenceView(
  channel: CommunicationChannel.fromJson(json['channel'] as String),
  consentVersion: (json['consentVersion'] as num).toInt(),
  contactId: json['contactId'] as String?,
  effectiveFrom: DateTime.parse(json['effectiveFrom'] as String),
  effectiveTo: json['effectiveTo'] == null
      ? null
      : DateTime.parse(json['effectiveTo'] as String),
  id: json['id'] as String,
  preference: CommunicationPreferenceValue.fromJson(
    json['preference'] as String,
  ),
  rowVersion: (json['rowVersion'] as num).toInt(),
);

Map<String, dynamic> _$CommunicationPreferenceViewToJson(
  CommunicationPreferenceView instance,
) => <String, dynamic>{
  'channel': instance.channel,
  'consentVersion': instance.consentVersion,
  'contactId': ?instance.contactId,
  'effectiveFrom': instance.effectiveFrom.toIso8601String(),
  'effectiveTo': ?instance.effectiveTo?.toIso8601String(),
  'id': instance.id,
  'preference': instance.preference,
  'rowVersion': instance.rowVersion,
};
