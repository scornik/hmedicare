// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'items2.dart';

part 'encounter_document_list.g.dart';

@JsonSerializable()
class EncounterDocumentList {
  const EncounterDocumentList({
    required this.hasMore,
    required this.items,
    required this.page,
  });
  
  factory EncounterDocumentList.fromJson(Map<String, Object?> json) => _$EncounterDocumentListFromJson(json);
  
  final bool hasMore;
  final List<Items2> items;
  final int page;

  Map<String, Object?> toJson() => _$EncounterDocumentListToJson(this);
}
