// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_telemedicine_sessions_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1TelemedicineSessionsIdResponse
_$GetApiV1TelemedicineSessionsIdResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1TelemedicineSessionsIdResponse(
      data: TelemedicineSession.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1TelemedicineSessionsIdResponseToJson(
  GetApiV1TelemedicineSessionsIdResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
