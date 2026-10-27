// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'document_upload_session.dart';
import 'response_meta.dart';

part 'post_api_v1_documents_upload_sessions_response.g.dart';

@JsonSerializable()
class PostApiV1DocumentsUploadSessionsResponse {
  const PostApiV1DocumentsUploadSessionsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1DocumentsUploadSessionsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1DocumentsUploadSessionsResponseFromJson(json);
  
  final DocumentUploadSession data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1DocumentsUploadSessionsResponseToJson(this);
}
