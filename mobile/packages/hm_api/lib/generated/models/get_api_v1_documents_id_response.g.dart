// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_documents_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1DocumentsIdResponse _$GetApiV1DocumentsIdResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1DocumentsIdResponse(
  data: DocumentMetadata.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1DocumentsIdResponseToJson(
  GetApiV1DocumentsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
