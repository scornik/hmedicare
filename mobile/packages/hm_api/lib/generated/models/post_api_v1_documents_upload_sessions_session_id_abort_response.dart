// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data4.dart';
import 'response_meta.dart';

part 'post_api_v1_documents_upload_sessions_session_id_abort_response.g.dart';

@JsonSerializable()
class PostApiV1DocumentsUploadSessionsSessionIdAbortResponse {
  const PostApiV1DocumentsUploadSessionsSessionIdAbortResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1DocumentsUploadSessionsSessionIdAbortResponse.fromJson(Map<String, Object?> json) => _$PostApiV1DocumentsUploadSessionsSessionIdAbortResponseFromJson(json);
  
  final Data4 data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1DocumentsUploadSessionsSessionIdAbortResponseToJson(this);
}
