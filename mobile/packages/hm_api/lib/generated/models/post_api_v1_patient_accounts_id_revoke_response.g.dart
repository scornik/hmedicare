// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_patient_accounts_id_revoke_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PatientAccountsIdRevokeResponse
_$PostApiV1PatientAccountsIdRevokeResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1PatientAccountsIdRevokeResponse(
      data: PatientAccount.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1PatientAccountsIdRevokeResponseToJson(
  PostApiV1PatientAccountsIdRevokeResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
