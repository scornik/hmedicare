// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'source_selection.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SourceSelection _$SourceSelectionFromJson(Map<String, dynamic> json) =>
    SourceSelection(
      draftSections: (json['draftSections'] as List<dynamic>?)
          ?.map((e) => DraftSections.fromJson(e as String))
          .toList(),
      lookbackDays: (json['lookbackDays'] as num?)?.toInt(),
      maxItems: (json['maxItems'] as num?)?.toInt(),
    );

Map<String, dynamic> _$SourceSelectionToJson(SourceSelection instance) =>
    <String, dynamic>{
      'draftSections': ?instance.draftSections,
      'lookbackDays': ?instance.lookbackDays,
      'maxItems': ?instance.maxItems,
    };
