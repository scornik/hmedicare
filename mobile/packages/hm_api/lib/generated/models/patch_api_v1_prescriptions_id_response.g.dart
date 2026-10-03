// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patch_api_v1_prescriptions_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatchApiV1PrescriptionsIdResponse _$PatchApiV1PrescriptionsIdResponseFromJson(
  Map<String, dynamic> json,
) => PatchApiV1PrescriptionsIdResponse(
  data: Prescription.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PatchApiV1PrescriptionsIdResponseToJson(
  PatchApiV1PrescriptionsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
