// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'guardianship.dart';
import 'response_meta.dart';

part 'post_api_v1_guardianships_id_activate_response.g.dart';

@JsonSerializable()
class PostApiV1GuardianshipsIdActivateResponse {
  const PostApiV1GuardianshipsIdActivateResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1GuardianshipsIdActivateResponse.fromJson(Map<String, Object?> json) => _$PostApiV1GuardianshipsIdActivateResponseFromJson(json);
  
  final Guardianship data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1GuardianshipsIdActivateResponseToJson(this);
}
