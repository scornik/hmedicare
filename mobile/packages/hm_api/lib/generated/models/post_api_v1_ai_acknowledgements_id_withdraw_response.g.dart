// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_ai_acknowledgements_id_withdraw_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AiAcknowledgementsIdWithdrawResponse
_$PostApiV1AiAcknowledgementsIdWithdrawResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1AiAcknowledgementsIdWithdrawResponse(
  data: AiAcknowledgement.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1AiAcknowledgementsIdWithdrawResponseToJson(
  PostApiV1AiAcknowledgementsIdWithdrawResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
