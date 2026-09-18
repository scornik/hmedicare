// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_auth_password_reset_complete_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AuthPasswordResetCompleteResponse
_$PostApiV1AuthPasswordResetCompleteResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1AuthPasswordResetCompleteResponse(
  data: json['data'],
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1AuthPasswordResetCompleteResponseToJson(
  PostApiV1AuthPasswordResetCompleteResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
