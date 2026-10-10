// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data.dart';
import 'response_meta.dart';

part 'get_api_v1_communication_links_token_response.g.dart';

@JsonSerializable()
class GetApiV1CommunicationLinksTokenResponse {
  const GetApiV1CommunicationLinksTokenResponse({
    required this.data,
    required this.meta,
  });
  
  factory GetApiV1CommunicationLinksTokenResponse.fromJson(Map<String, Object?> json) => _$GetApiV1CommunicationLinksTokenResponseFromJson(json);
  
  final Data data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$GetApiV1CommunicationLinksTokenResponseToJson(this);
}
