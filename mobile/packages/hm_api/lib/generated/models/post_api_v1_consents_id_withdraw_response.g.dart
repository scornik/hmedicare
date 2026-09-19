// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_consents_id_withdraw_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1ConsentsIdWithdrawResponse
_$PostApiV1ConsentsIdWithdrawResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1ConsentsIdWithdrawResponse(
      data: Consent.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1ConsentsIdWithdrawResponseToJson(
  PostApiV1ConsentsIdWithdrawResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
