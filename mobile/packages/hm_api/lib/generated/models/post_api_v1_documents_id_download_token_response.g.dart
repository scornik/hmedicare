// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_documents_id_download_token_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1DocumentsIdDownloadTokenResponse
_$PostApiV1DocumentsIdDownloadTokenResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1DocumentsIdDownloadTokenResponse(
  data: DownloadTokenResponse.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1DocumentsIdDownloadTokenResponseToJson(
  PostApiV1DocumentsIdDownloadTokenResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
