// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient_account_list_response.dart';
import 'response_meta.dart';

part 'get_api_v1_patient_accounts_response.g.dart';

@JsonSerializable()
class GetApiV1PatientAccountsResponse {
  const GetApiV1PatientAccountsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1PatientAccountsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1PatientAccountsResponseFromJson(json);
  
  final PatientAccountListResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1PatientAccountsResponseToJson(this);
}
