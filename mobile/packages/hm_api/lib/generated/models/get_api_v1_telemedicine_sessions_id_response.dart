// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'telemedicine_session.dart';
import 'response_meta.dart';

part 'get_api_v1_telemedicine_sessions_id_response.g.dart';

@JsonSerializable()
class GetApiV1TelemedicineSessionsIdResponse {
  const GetApiV1TelemedicineSessionsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1TelemedicineSessionsIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1TelemedicineSessionsIdResponseFromJson(json);
  
  final TelemedicineSession data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1TelemedicineSessionsIdResponseToJson(this);
}
