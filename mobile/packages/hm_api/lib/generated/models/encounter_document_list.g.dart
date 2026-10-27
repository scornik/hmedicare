// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'encounter_document_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EncounterDocumentList _$EncounterDocumentListFromJson(
  Map<String, dynamic> json,
) => EncounterDocumentList(
  hasMore: json['hasMore'] as bool,
  items: (json['items'] as List<dynamic>)
      .map((e) => Items2.fromJson(e as Map<String, dynamic>))
      .toList(),
  page: (json['page'] as num).toInt(),
);

Map<String, dynamic> _$EncounterDocumentListToJson(
  EncounterDocumentList instance,
) => <String, dynamic>{
  'hasMore': instance.hasMore,
  'items': instance.items,
  'page': instance.page,
};
