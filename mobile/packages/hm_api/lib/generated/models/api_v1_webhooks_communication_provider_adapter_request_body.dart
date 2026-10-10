// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'communication_receipt_status.dart';

part 'api_v1_webhooks_communication_provider_adapter_request_body.g.dart';

@JsonSerializable()
class ApiV1WebhooksCommunicationProviderAdapterRequestBody {
  const ApiV1WebhooksCommunicationProviderAdapterRequestBody({
    required this.eventId,
    required this.messageId,
    required this.status,
  });
  
  factory ApiV1WebhooksCommunicationProviderAdapterRequestBody.fromJson(Map<String, Object?> json) => _$ApiV1WebhooksCommunicationProviderAdapterRequestBodyFromJson(json);
  
  final String eventId;
  final String messageId;
  final CommunicationReceiptStatus status;

  Map<String, Object?> toJson() => _$ApiV1WebhooksCommunicationProviderAdapterRequestBodyToJson(this);
}
