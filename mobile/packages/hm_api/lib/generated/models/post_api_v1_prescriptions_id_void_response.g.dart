// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_prescriptions_id_void_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PrescriptionsIdVoidResponse
_$PostApiV1PrescriptionsIdVoidResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1PrescriptionsIdVoidResponse(
      data: Prescription.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1PrescriptionsIdVoidResponseToJson(
  PostApiV1PrescriptionsIdVoidResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
