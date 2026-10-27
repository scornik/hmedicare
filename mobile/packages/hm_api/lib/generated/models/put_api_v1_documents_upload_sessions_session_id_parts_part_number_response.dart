// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data6.dart';
import 'response_meta.dart';

part 'put_api_v1_documents_upload_sessions_session_id_parts_part_number_response.g.dart';

@JsonSerializable()
class PutApiV1DocumentsUploadSessionsSessionIdPartsPartNumberResponse {
  const PutApiV1DocumentsUploadSessionsSessionIdPartsPartNumberResponse({
    required this.data,
    required this.meta,
  });
  
  factory PutApiV1DocumentsUploadSessionsSessionIdPartsPartNumberResponse.fromJson(Map<String, Object?> json) => _$PutApiV1DocumentsUploadSessionsSessionIdPartsPartNumberResponseFromJson(json);
  
  final Data6 data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PutApiV1DocumentsUploadSessionsSessionIdPartsPartNumberResponseToJson(this);
}
