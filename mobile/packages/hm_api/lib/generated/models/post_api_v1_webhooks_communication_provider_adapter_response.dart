// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data5.dart';
import 'response_meta.dart';

part 'post_api_v1_webhooks_communication_provider_adapter_response.g.dart';

@JsonSerializable()
class PostApiV1WebhooksCommunicationProviderAdapterResponse {
  const PostApiV1WebhooksCommunicationProviderAdapterResponse({
    required this.data,
    required this.meta,
  });
  
  factory PostApiV1WebhooksCommunicationProviderAdapterResponse.fromJson(Map<String, Object?> json) => _$PostApiV1WebhooksCommunicationProviderAdapterResponseFromJson(json);
  
  final Data5 data;
  final ResponseMeta meta;

  Map<String, Object?> toJson() => _$PostApiV1WebhooksCommunicationProviderAdapterResponseToJson(this);
}
