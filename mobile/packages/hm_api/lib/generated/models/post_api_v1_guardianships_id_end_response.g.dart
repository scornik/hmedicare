// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_guardianships_id_end_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1GuardianshipsIdEndResponse
_$PostApiV1GuardianshipsIdEndResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1GuardianshipsIdEndResponse(
      data: Guardianship.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1GuardianshipsIdEndResponseToJson(
  PostApiV1GuardianshipsIdEndResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
