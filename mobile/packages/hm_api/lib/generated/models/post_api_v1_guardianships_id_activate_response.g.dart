// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_guardianships_id_activate_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1GuardianshipsIdActivateResponse
_$PostApiV1GuardianshipsIdActivateResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1GuardianshipsIdActivateResponse(
      data: Guardianship.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1GuardianshipsIdActivateResponseToJson(
  PostApiV1GuardianshipsIdActivateResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
