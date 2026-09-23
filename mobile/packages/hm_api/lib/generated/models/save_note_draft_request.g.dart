// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'save_note_draft_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SaveNoteDraftRequest _$SaveNoteDraftRequestFromJson(
  Map<String, dynamic> json,
) => SaveNoteDraftRequest(
  expectedRowVersion: (json['expectedRowVersion'] as num).toInt(),
  sections: Sections.fromJson(json['sections'] as Map<String, dynamic>),
);

Map<String, dynamic> _$SaveNoteDraftRequestToJson(
  SaveNoteDraftRequest instance,
) => <String, dynamic>{
  'expectedRowVersion': instance.expectedRowVersion,
  'sections': instance.sections,
};
