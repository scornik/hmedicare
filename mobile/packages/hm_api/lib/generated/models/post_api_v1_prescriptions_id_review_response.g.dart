// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_prescriptions_id_review_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PrescriptionsIdReviewResponse
_$PostApiV1PrescriptionsIdReviewResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1PrescriptionsIdReviewResponse(
      data: Prescription.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1PrescriptionsIdReviewResponseToJson(
  PostApiV1PrescriptionsIdReviewResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
