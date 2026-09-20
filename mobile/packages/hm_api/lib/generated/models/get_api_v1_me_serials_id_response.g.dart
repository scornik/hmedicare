// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_me_serials_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1MeSerialsIdResponse _$GetApiV1MeSerialsIdResponseFromJson(
  Map<String, dynamic> json,
) => GetApiV1MeSerialsIdResponse(
  data: PatientSerialView.fromJson(json['data'] as Map<String, dynamic>),
  meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
);

Map<String, dynamic> _$GetApiV1MeSerialsIdResponseToJson(
  GetApiV1MeSerialsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
