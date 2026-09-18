// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_auth_session_logout_all_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AuthSessionLogoutAllResponse
_$PostApiV1AuthSessionLogoutAllResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1AuthSessionLogoutAllResponse(
      data: json['data'],
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1AuthSessionLogoutAllResponseToJson(
  PostApiV1AuthSessionLogoutAllResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
