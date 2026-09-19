// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'guardianship.dart';
import 'response_meta.dart';

part 'post_api_v1_guardianships_id_end_response.g.dart';

@JsonSerializable()
class PostApiV1GuardianshipsIdEndResponse {
  const PostApiV1GuardianshipsIdEndResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1GuardianshipsIdEndResponse.fromJson(Map<String, Object?> json) => _$PostApiV1GuardianshipsIdEndResponseFromJson(json);
  
  final Guardianship data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1GuardianshipsIdEndResponseToJson(this);
}
