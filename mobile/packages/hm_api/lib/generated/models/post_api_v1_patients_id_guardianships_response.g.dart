// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_patients_id_guardianships_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PatientsIdGuardianshipsResponse
_$PostApiV1PatientsIdGuardianshipsResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1PatientsIdGuardianshipsResponse(
      data: Guardianship.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1PatientsIdGuardianshipsResponseToJson(
  PostApiV1PatientsIdGuardianshipsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
