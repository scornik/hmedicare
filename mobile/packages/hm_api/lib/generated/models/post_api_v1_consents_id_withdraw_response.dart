// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'consent.dart';
import 'response_meta.dart';

part 'post_api_v1_consents_id_withdraw_response.g.dart';

@JsonSerializable()
class PostApiV1ConsentsIdWithdrawResponse {
  const PostApiV1ConsentsIdWithdrawResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1ConsentsIdWithdrawResponse.fromJson(Map<String, Object?> json) => _$PostApiV1ConsentsIdWithdrawResponseFromJson(json);
  
  final Consent data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1ConsentsIdWithdrawResponseToJson(this);
}
