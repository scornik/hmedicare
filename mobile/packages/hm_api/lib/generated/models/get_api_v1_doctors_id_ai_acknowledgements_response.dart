// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'ai_acknowledgement_list.dart';
import 'response_meta.dart';

part 'get_api_v1_doctors_id_ai_acknowledgements_response.g.dart';

@JsonSerializable()
class GetApiV1DoctorsIdAiAcknowledgementsResponse {
  const GetApiV1DoctorsIdAiAcknowledgementsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1DoctorsIdAiAcknowledgementsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1DoctorsIdAiAcknowledgementsResponseFromJson(json);
  
  final AiAcknowledgementList data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1DoctorsIdAiAcknowledgementsResponseToJson(this);
}
