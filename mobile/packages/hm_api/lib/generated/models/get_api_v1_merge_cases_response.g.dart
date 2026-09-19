// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_merge_cases_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1MergeCasesResponse _$GetApiV1MergeCasesResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1MergeCasesResponse(
  data: MergeCaseListResponse.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1MergeCasesResponseToJson(
  GetApiV1MergeCasesResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
