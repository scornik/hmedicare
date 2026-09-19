// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'guardianship_list_response.dart';
import 'response_meta.dart';

part 'get_api_v1_guardianships_response.g.dart';

@JsonSerializable()
class GetApiV1GuardianshipsResponse {
  const GetApiV1GuardianshipsResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1GuardianshipsResponse.fromJson(Map<String, Object?> json) => _$GetApiV1GuardianshipsResponseFromJson(json);
  
  final GuardianshipListResponse data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1GuardianshipsResponseToJson(this);
}
