// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_medications_search_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1MedicationsSearchResponse _$GetApiV1MedicationsSearchResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1MedicationsSearchResponse(
  data: MedicationSearchResults.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1MedicationsSearchResponseToJson(
  GetApiV1MedicationsSearchResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
