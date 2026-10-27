// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'document_metadata.dart';
import 'response_meta.dart';

part 'get_api_v1_documents_id_response.g.dart';

@JsonSerializable()
class GetApiV1DocumentsIdResponse {
  const GetApiV1DocumentsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1DocumentsIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1DocumentsIdResponseFromJson(json);
  
  final DocumentMetadata data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1DocumentsIdResponseToJson(this);
}
