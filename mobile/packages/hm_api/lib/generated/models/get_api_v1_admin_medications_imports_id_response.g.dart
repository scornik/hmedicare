// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_admin_medications_imports_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1AdminMedicationsImportsIdResponse
_$GetApiV1AdminMedicationsImportsIdResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1AdminMedicationsImportsIdResponse(
  data: MedicationImport.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1AdminMedicationsImportsIdResponseToJson(
  GetApiV1AdminMedicationsImportsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
