// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_encounters_id_prescriptions_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1EncountersIdPrescriptionsResponse
_$GetApiV1EncountersIdPrescriptionsResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1EncountersIdPrescriptionsResponse(
  data: PrescriptionList.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1EncountersIdPrescriptionsResponseToJson(
  GetApiV1EncountersIdPrescriptionsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
