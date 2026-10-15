// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_acknowledgement_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiAcknowledgementList _$AiAcknowledgementListFromJson(
  Map<String, dynamic> json,
) => AiAcknowledgementList(
  items: (json['items'] as List<dynamic>)
      .map((e) => AiAcknowledgement.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$AiAcknowledgementListToJson(
  AiAcknowledgementList instance,
) => <String, dynamic>{'items': instance.items};
