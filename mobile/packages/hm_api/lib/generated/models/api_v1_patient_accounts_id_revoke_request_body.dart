// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'api_v1_patient_accounts_id_revoke_request_body.g.dart';

@JsonSerializable()
class ApiV1PatientAccountsIdRevokeRequestBody {
  const ApiV1PatientAccountsIdRevokeRequestBody({
    required this.expectedRowVersion,
  });
  
  factory ApiV1PatientAccountsIdRevokeRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1PatientAccountsIdRevokeRequestBodyFromJson(json);
  
  final int expectedRowVersion;

  Map<String, Object?> toJson() => _$ApiV1PatientAccountsIdRevokeRequestBodyToJson(this);
}
