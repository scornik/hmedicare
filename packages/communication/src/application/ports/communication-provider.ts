/** Provider inputs exist only in process; never serialize them into jobs or audit metadata. */
export interface SendCommunicationInput {
  tenantId: string;
  communicationId: string;
  attemptId: string;
  idempotencyKey: string;
  destination: string;
  text: string;
  locale: string;
}

export type NormalizedDeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'UNKNOWN';
export type ProviderStatus = string;
export type ProviderSendResult =
  | { outcome: 'ACCEPTED'; providerMessageId: string }
  | { outcome: 'TRANSIENT_FAILURE'; errorClass: 'PROVIDER_UNAVAILABLE' }
  | { outcome: 'PERMANENT_FAILURE'; errorClass: 'DESTINATION_UNSUPPORTED' | 'INVALID_REQUEST' }
  | { outcome: 'RATE_LIMITED'; retryAfterSeconds: number };

export interface WebhookInput {
  /** Exact received bytes, before JSON parsing. */
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string | undefined>>;
}

export interface ProviderReceipt {
  providerAdapter: string;
  providerEventId: string;
  providerMessageId: string;
  status: NormalizedDeliveryStatus;
}

export interface CommunicationProvider {
  readonly code: string;
  send(input: SendCommunicationInput): Promise<ProviderSendResult>;
  verifyWebhook(input: WebhookInput): Promise<ProviderReceipt | null>;
  mapStatus(input: ProviderStatus): NormalizedDeliveryStatus;
}

export interface EmailProvider extends CommunicationProvider {
  readonly channel: 'email';
}
export interface WhatsAppProvider extends CommunicationProvider {
  readonly channel: 'whatsapp';
}
export interface PushProvider extends CommunicationProvider {
  readonly channel: 'push';
}
