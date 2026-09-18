// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_auth_session_csrf_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AuthSessionCsrfResponse _$PostApiV1AuthSessionCsrfResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1AuthSessionCsrfResponse(
  data: CsrfResponse.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1AuthSessionCsrfResponseToJson(
  PostApiV1AuthSessionCsrfResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
