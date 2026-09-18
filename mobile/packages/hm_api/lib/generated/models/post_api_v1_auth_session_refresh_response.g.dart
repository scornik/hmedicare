// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_auth_session_refresh_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AuthSessionRefreshResponse
_$PostApiV1AuthSessionRefreshResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1AuthSessionRefreshResponse(
      data: SessionResponse.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1AuthSessionRefreshResponseToJson(
  PostApiV1AuthSessionRefreshResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
