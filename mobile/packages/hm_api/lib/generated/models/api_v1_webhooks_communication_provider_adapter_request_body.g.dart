// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'api_v1_webhooks_communication_provider_adapter_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApiV1WebhooksCommunicationProviderAdapterRequestBody
_$ApiV1WebhooksCommunicationProviderAdapterRequestBodyFromJson(
  Map<String, dynamic> json,
) => ApiV1WebhooksCommunicationProviderAdapterRequestBody(
  eventId: json['eventId'] as String,
  messageId: json['messageId'] as String,
  status: CommunicationReceiptStatus.fromJson(json['status'] as String),
);

Map<String, dynamic>
_$ApiV1WebhooksCommunicationProviderAdapterRequestBodyToJson(
  ApiV1WebhooksCommunicationProviderAdapterRequestBody instance,
) => <String, dynamic>{
  'eventId': instance.eventId,
  'messageId': instance.messageId,
  'status': instance.status,
};
