// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_doctor_coverages_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1DoctorCoveragesResponse _$GetApiV1DoctorCoveragesResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1DoctorCoveragesResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => DoctorCoverage.fromJson(e as Map<String, dynamic>))
      .toList(),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1DoctorCoveragesResponseToJson(
  GetApiV1DoctorCoveragesResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
