// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_patients_duplicate_check_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1PatientsDuplicateCheckResponse
_$PostApiV1PatientsDuplicateCheckResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1PatientsDuplicateCheckResponse(
      data: DuplicateCheckResponse.fromJson(
        json['data'] as Map<String, dynamic>,
      ),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1PatientsDuplicateCheckResponseToJson(
  PostApiV1PatientsDuplicateCheckResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
