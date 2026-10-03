// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_prescriptions_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1PrescriptionsIdResponse _$GetApiV1PrescriptionsIdResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1PrescriptionsIdResponse(
  data: Prescription.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1PrescriptionsIdResponseToJson(
  GetApiV1PrescriptionsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
