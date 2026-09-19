// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'patient_account.dart';
import 'response_meta.dart';

part 'post_api_v1_patient_accounts_link_requests_response.g.dart';

@JsonSerializable()
class PostApiV1PatientAccountsLinkRequestsResponse {
  const PostApiV1PatientAccountsLinkRequestsResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1PatientAccountsLinkRequestsResponse.fromJson(Map<String, Object?> json) => _$PostApiV1PatientAccountsLinkRequestsResponseFromJson(json);
  
  final PatientAccount data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1PatientAccountsLinkRequestsResponseToJson(this);
}
