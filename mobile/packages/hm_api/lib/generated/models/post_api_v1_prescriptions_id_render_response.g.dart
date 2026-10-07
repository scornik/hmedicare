// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_prescriptions_id_render_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PrescriptionsIdRenderResponse
_$PostApiV1PrescriptionsIdRenderResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1PrescriptionsIdRenderResponse(
      data: RenderPrescriptionResponse.fromJson(
        json['data'] as Map<String, dynamic>,
      ),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1PrescriptionsIdRenderResponseToJson(
  PostApiV1PrescriptionsIdRenderResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
