// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_ai_models_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1AiModelsResponse _$GetApiV1AiModelsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1AiModelsResponse(
  data: AiModelList.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1AiModelsResponseToJson(
  GetApiV1AiModelsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
