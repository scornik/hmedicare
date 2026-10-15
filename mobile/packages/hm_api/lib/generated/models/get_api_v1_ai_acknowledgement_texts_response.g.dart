// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_ai_acknowledgement_texts_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1AiAcknowledgementTextsResponse
_$GetApiV1AiAcknowledgementTextsResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1AiAcknowledgementTextsResponse(
      data: AiAcknowledgementTextList.fromJson(
        json['data'] as Map<String, dynamic>,
      ),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1AiAcknowledgementTextsResponseToJson(
  GetApiV1AiAcknowledgementTextsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
