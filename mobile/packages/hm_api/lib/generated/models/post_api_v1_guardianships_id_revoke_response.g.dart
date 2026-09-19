// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_guardianships_id_revoke_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1GuardianshipsIdRevokeResponse
_$PostApiV1GuardianshipsIdRevokeResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1GuardianshipsIdRevokeResponse(
      data: Guardianship.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1GuardianshipsIdRevokeResponseToJson(
  PostApiV1GuardianshipsIdRevokeResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
