// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data5.dart';
import 'response_meta.dart';

part 'post_api_v1_documents_upload_sessions_session_id_finalize_response.g.dart';

@JsonSerializable()
class PostApiV1DocumentsUploadSessionsSessionIdFinalizeResponse {
  const PostApiV1DocumentsUploadSessionsSessionIdFinalizeResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1DocumentsUploadSessionsSessionIdFinalizeResponse.fromJson(Map<String, Object?> json) => _$PostApiV1DocumentsUploadSessionsSessionIdFinalizeResponseFromJson(json);
  
  final Data5 data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1DocumentsUploadSessionsSessionIdFinalizeResponseToJson(this);
}
