// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient_serial_view.dart';
import 'response_meta.dart';

part 'get_api_v1_me_serials_id_response.g.dart';

@JsonSerializable()
class GetApiV1MeSerialsIdResponse {
  const GetApiV1MeSerialsIdResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1MeSerialsIdResponse.fromJson(Map<String, Object?> json) => _$GetApiV1MeSerialsIdResponseFromJson(json);
  
  final PatientSerialView data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1MeSerialsIdResponseToJson(this);
}
