// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_patient_accounts_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1PatientAccountsResponse _$GetApiV1PatientAccountsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1PatientAccountsResponse(
  data: PatientAccountListResponse.fromJson(
    json['data'] as Map<String, dynamic>,
  ),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1PatientAccountsResponseToJson(
  GetApiV1PatientAccountsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
