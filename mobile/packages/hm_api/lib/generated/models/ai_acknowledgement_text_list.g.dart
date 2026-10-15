// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_acknowledgement_text_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiAcknowledgementTextList _$AiAcknowledgementTextListFromJson(
  Map<String, dynamic> json,
) => AiAcknowledgementTextList(
  items: (json['items'] as List<dynamic>)
      .map((e) => AiAcknowledgementText.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$AiAcknowledgementTextListToJson(
  AiAcknowledgementTextList instance,
) => <String, dynamic>{'items': instance.items};
