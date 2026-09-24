// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_admin_medications_imports_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1AdminMedicationsImportsResponse
_$GetApiV1AdminMedicationsImportsResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1AdminMedicationsImportsResponse(
      data: MedicationImportList.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1AdminMedicationsImportsResponseToJson(
  GetApiV1AdminMedicationsImportsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
