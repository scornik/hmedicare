// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_patient_accounts_id_verify_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PatientAccountsIdVerifyResponse
_$PostApiV1PatientAccountsIdVerifyResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1PatientAccountsIdVerifyResponse(
      data: PatientAccount.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1PatientAccountsIdVerifyResponseToJson(
  PostApiV1PatientAccountsIdVerifyResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
