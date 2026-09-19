// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_guardianships_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1GuardianshipsResponse _$GetApiV1GuardianshipsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1GuardianshipsResponse(
  data: GuardianshipListResponse.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1GuardianshipsResponseToJson(
  GetApiV1GuardianshipsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
