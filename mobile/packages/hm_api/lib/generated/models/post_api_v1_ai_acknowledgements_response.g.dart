// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_ai_acknowledgements_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AiAcknowledgementsResponse
_$PostApiV1AiAcknowledgementsResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1AiAcknowledgementsResponse(
      data: AiAcknowledgement.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1AiAcknowledgementsResponseToJson(
  PostApiV1AiAcknowledgementsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
