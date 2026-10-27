// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encounter_document_list.dart';
import 'response_meta.dart';

part 'get_api_v1_documents_by_encounter_encounter_id_response.g.dart';

@JsonSerializable()
class GetApiV1DocumentsByEncounterEncounterIdResponse {
  const GetApiV1DocumentsByEncounterEncounterIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1DocumentsByEncounterEncounterIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1DocumentsByEncounterEncounterIdResponseFromJson(json);
  
  final EncounterDocumentList data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1DocumentsByEncounterEncounterIdResponseToJson(this);
}
