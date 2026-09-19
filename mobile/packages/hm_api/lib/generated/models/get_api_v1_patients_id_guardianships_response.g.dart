// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_patients_id_guardianships_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1PatientsIdGuardianshipsResponse
_$GetApiV1PatientsIdGuardianshipsResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1PatientsIdGuardianshipsResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => Guardianship.fromJson(e as Map<String, dynamic>))
          .toList(),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1PatientsIdGuardianshipsResponseToJson(
  GetApiV1PatientsIdGuardianshipsResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
