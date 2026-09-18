// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_auth_password_login_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AuthPasswordLoginResponse _$PostApiV1AuthPasswordLoginResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1AuthPasswordLoginResponse(
  data: SessionResponse.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1AuthPasswordLoginResponseToJson(
  PostApiV1AuthPasswordLoginResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
