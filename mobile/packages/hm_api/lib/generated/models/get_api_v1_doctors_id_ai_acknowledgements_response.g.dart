// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_doctors_id_ai_acknowledgements_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1DoctorsIdAiAcknowledgementsResponse
_$GetApiV1DoctorsIdAiAcknowledgementsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1DoctorsIdAiAcknowledgementsResponse(
  data: AiAcknowledgementList.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1DoctorsIdAiAcknowledgementsResponseToJson(
  GetApiV1DoctorsIdAiAcknowledgementsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
