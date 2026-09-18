// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_me_sessions_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1MeSessionsResponse _$GetApiV1MeSessionsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1MeSessionsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => SessionSummary.fromJson(e as Map<String, dynamic>))
      .toList(),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1MeSessionsResponseToJson(
  GetApiV1MeSessionsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
