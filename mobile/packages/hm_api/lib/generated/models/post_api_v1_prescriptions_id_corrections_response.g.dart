// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_prescriptions_id_corrections_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PrescriptionsIdCorrectionsResponse
_$PostApiV1PrescriptionsIdCorrectionsResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1PrescriptionsIdCorrectionsResponse(
  data: Prescription.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1PrescriptionsIdCorrectionsResponseToJson(
  PostApiV1PrescriptionsIdCorrectionsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
