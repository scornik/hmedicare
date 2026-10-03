// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_encounters_id_prescriptions_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1EncountersIdPrescriptionsResponse
_$PostApiV1EncountersIdPrescriptionsResponseFromJson(
  Map<String, dynamic> json,
) => PostApiV1EncountersIdPrescriptionsResponse(
  data: Prescription.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PostApiV1EncountersIdPrescriptionsResponseToJson(
  PostApiV1EncountersIdPrescriptionsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
