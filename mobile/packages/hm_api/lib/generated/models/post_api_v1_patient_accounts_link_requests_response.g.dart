// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_patient_accounts_link_requests_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PatientAccountsLinkRequestsResponse
_$PostApiV1PatientAccountsLinkRequestsResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1PatientAccountsLinkRequestsResponse(
  data: PatientAccount.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1PatientAccountsLinkRequestsResponseToJson(
  PostApiV1PatientAccountsLinkRequestsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
