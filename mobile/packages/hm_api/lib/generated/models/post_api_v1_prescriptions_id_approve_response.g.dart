// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_prescriptions_id_approve_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PrescriptionsIdApproveResponse
_$PostApiV1PrescriptionsIdApproveResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1PrescriptionsIdApproveResponse(
      data: Prescription.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1PrescriptionsIdApproveResponseToJson(
  PostApiV1PrescriptionsIdApproveResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
