// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_auth_password_reset_request_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AuthPasswordResetRequestResponse
_$PostApiV1AuthPasswordResetRequestResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1AuthPasswordResetRequestResponse(
  data: json['data'],
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1AuthPasswordResetRequestResponseToJson(
  PostApiV1AuthPasswordResetRequestResponse instance,
) => <String, dynamic>{'data': ?instance.data, 'meta': instance.meta};
