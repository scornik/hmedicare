// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_approved_note_section.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiApprovedNoteSection _$AiApprovedNoteSectionFromJson(
  Map<String, dynamic> json,
) => AiApprovedNoteSection(
  expectedNoteRowVersion: (json['expectedNoteRowVersion'] as num).toInt(),
  mode: AiApprovedNoteSectionMode.fromJson(json['mode'] as String),
  section: AiApprovedNoteSectionSection.fromJson(json['section'] as String),
  text: json['text'] as String,
);

Map<String, dynamic> _$AiApprovedNoteSectionToJson(
  AiApprovedNoteSection instance,
) => <String, dynamic>{
  'expectedNoteRowVersion': instance.expectedNoteRowVersion,
  'mode': instance.mode,
  'section': instance.section,
  'text': instance.text,
};
