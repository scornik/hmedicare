// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_doctor_coverages_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1DoctorCoveragesResponse _$PostApiV1DoctorCoveragesResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1DoctorCoveragesResponse(
  data: DoctorCoverage.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1DoctorCoveragesResponseToJson(
  PostApiV1DoctorCoveragesResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
