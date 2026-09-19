// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_patients_id_merge_cases_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PatientsIdMergeCasesResponse
_$PostApiV1PatientsIdMergeCasesResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1PatientsIdMergeCasesResponse(
      data: MergeCase.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1PatientsIdMergeCasesResponseToJson(
  PostApiV1PatientsIdMergeCasesResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
