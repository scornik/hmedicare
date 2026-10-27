// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_documents_upload_sessions_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1DocumentsUploadSessionsResponse
_$PostApiV1DocumentsUploadSessionsResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1DocumentsUploadSessionsResponse(
      data: DocumentUploadSession.fromJson(
        json['data'] as Map<String, dynamic>,
      ),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1DocumentsUploadSessionsResponseToJson(
  PostApiV1DocumentsUploadSessionsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
