// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_admin_medications_gates_dataset_version_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1AdminMedicationsGatesDatasetVersionResponse
_$GetApiV1AdminMedicationsGatesDatasetVersionResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1AdminMedicationsGatesDatasetVersionResponse(
  data: MedicationGateStatus.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic>
_$GetApiV1AdminMedicationsGatesDatasetVersionResponseToJson(
  GetApiV1AdminMedicationsGatesDatasetVersionResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
