// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_doctor_coverages_id_revoke_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1DoctorCoveragesIdRevokeResponse
_$PostApiV1DoctorCoveragesIdRevokeResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1DoctorCoveragesIdRevokeResponse(
      data: DoctorCoverage.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1DoctorCoveragesIdRevokeResponseToJson(
  PostApiV1DoctorCoveragesIdRevokeResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
