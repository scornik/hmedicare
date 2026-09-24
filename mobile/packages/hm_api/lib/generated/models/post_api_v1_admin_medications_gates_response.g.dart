// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_admin_medications_gates_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1AdminMedicationsGatesResponse
_$PostApiV1AdminMedicationsGatesResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1AdminMedicationsGatesResponse(
      data: RecordMedicationGateResponse.fromJson(
        json['data'] as Map<String, dynamic>,
      ),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1AdminMedicationsGatesResponseToJson(
  PostApiV1AdminMedicationsGatesResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
