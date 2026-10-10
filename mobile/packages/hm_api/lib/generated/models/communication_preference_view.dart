// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'communication_channel.dart';
import 'communication_preference_value.dart';

part 'communication_preference_view.g.dart';

@JsonSerializable()
class CommunicationPreferenceView {
  const CommunicationPreferenceView({
    required this.channel,
    required this.consentVersion,
    required this.contactId,
    required this.effectiveFrom,
    required this.effectiveTo,
    required this.id,
    required this.preference,
    required this.rowVersion,
  });
  
  factory CommunicationPreferenceView.fromJson(Map<String, Object?> json) => _$CommunicationPreferenceViewFromJson(json);
  
  final CommunicationChannel channel;
  final int consentVersion;
  final String? contactId;
  final DateTime effectiveFrom;
  final DateTime? effectiveTo;
  final String id;
  final CommunicationPreferenceValue preference;
  final int rowVersion;

  Map<String, Object?> toJson() => _$CommunicationPreferenceViewToJson(this);
}
