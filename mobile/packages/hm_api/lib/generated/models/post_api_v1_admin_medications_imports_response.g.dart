// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_admin_medications_imports_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AdminMedicationsImportsResponse
_$PostApiV1AdminMedicationsImportsResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1AdminMedicationsImportsResponse(
      data: RequestMedicationImportResponse.fromJson(
        json['data'] as Map<String, dynamic>,
      ),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1AdminMedicationsImportsResponseToJson(
  PostApiV1AdminMedicationsImportsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
