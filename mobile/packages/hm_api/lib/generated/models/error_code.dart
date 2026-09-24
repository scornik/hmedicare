// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum ErrorCode {
  @JsonValue('UNAUTHENTICATED')
  unauthenticated('UNAUTHENTICATED'),
  @JsonValue('SESSION_REVOKED')
  sessionRevoked('SESSION_REVOKED'),
  @JsonValue('FORBIDDEN')
  forbidden('FORBIDDEN'),
  @JsonValue('CSRF_FAILED')
  csrfFailed('CSRF_FAILED'),
  @JsonValue('TENANT_CONTEXT_REQUIRED')
  tenantContextRequired('TENANT_CONTEXT_REQUIRED'),
  @JsonValue('PATIENT_CONTEXT_REQUIRED')
  patientContextRequired('PATIENT_CONTEXT_REQUIRED'),
  @JsonValue('RESOURCE_NOT_FOUND')
  resourceNotFound('RESOURCE_NOT_FOUND'),
  @JsonValue('VALIDATION_FAILED')
  validationFailed('VALIDATION_FAILED'),
  @JsonValue('RATE_LIMITED')
  rateLimited('RATE_LIMITED'),
  @JsonValue('IDEMPOTENCY_KEY_REQUIRED')
  idempotencyKeyRequired('IDEMPOTENCY_KEY_REQUIRED'),
  @JsonValue('IDEMPOTENCY_REPLAY')
  idempotencyReplay('IDEMPOTENCY_REPLAY'),
  @JsonValue('IDEMPOTENCY_IN_PROGRESS')
  idempotencyInProgress('IDEMPOTENCY_IN_PROGRESS'),
  @JsonValue('IDEMPOTENCY_KEY_REUSED')
  idempotencyKeyReused('IDEMPOTENCY_KEY_REUSED'),
  @JsonValue('STALE_VERSION')
  staleVersion('STALE_VERSION'),
  @JsonValue('QUEUE_STATE_CONFLICT')
  queueStateConflict('QUEUE_STATE_CONFLICT'),
  @JsonValue('QUEUE_VERSION_CONFLICT')
  queueVersionConflict('QUEUE_VERSION_CONFLICT'),
  @JsonValue('QUEUE_BUSY')
  queueBusy('QUEUE_BUSY'),
  @JsonValue('CONCURRENCY_RETRY_EXHAUSTED')
  concurrencyRetryExhausted('CONCURRENCY_RETRY_EXHAUSTED'),
  @JsonValue('INVALID_TRANSITION')
  invalidTransition('INVALID_TRANSITION'),
  @JsonValue('DUPLICATE_ACTIVE_SERIAL')
  duplicateActiveSerial('DUPLICATE_ACTIVE_SERIAL'),
  @JsonValue('RECALL_LIMIT_REACHED')
  recallLimitReached('RECALL_LIMIT_REACHED'),
  @JsonValue('CHAMBER_DAY_CLOSED')
  chamberDayClosed('CHAMBER_DAY_CLOSED'),
  @JsonValue('CHAMBER_DAY_HAS_ACTIVE_CONSULTATION')
  chamberDayHasActiveConsultation('CHAMBER_DAY_HAS_ACTIVE_CONSULTATION'),
  @JsonValue('CAPACITY_EXCEEDED')
  capacityExceeded('CAPACITY_EXCEEDED'),
  @JsonValue('DUPLICATE_PATIENT_REVIEW_REQUIRED')
  duplicatePatientReviewRequired('DUPLICATE_PATIENT_REVIEW_REQUIRED'),
  @JsonValue('PRESCRIPTION_NOT_APPROVED')
  prescriptionNotApproved('PRESCRIPTION_NOT_APPROVED'),
  @JsonValue('PRESCRIPTION_NOT_EDITABLE')
  prescriptionNotEditable('PRESCRIPTION_NOT_EDITABLE'),
  @JsonValue('UPLOAD_EXPIRED')
  uploadExpired('UPLOAD_EXPIRED'),
  @JsonValue('ENDPOINT_RETIRED')
  endpointRetired('ENDPOINT_RETIRED'),
  @JsonValue('CHECKSUM_MISMATCH')
  checksumMismatch('CHECKSUM_MISMATCH'),
  @JsonValue('CONTENT_TYPE_NOT_ALLOWED')
  contentTypeNotAllowed('CONTENT_TYPE_NOT_ALLOWED'),
  @JsonValue('PAYLOAD_TOO_LARGE')
  payloadTooLarge('PAYLOAD_TOO_LARGE'),
  @JsonValue('DOCUMENT_NOT_AVAILABLE')
  documentNotAvailable('DOCUMENT_NOT_AVAILABLE'),
  @JsonValue('DOWNLOAD_TOKEN_INVALID')
  downloadTokenInvalid('DOWNLOAD_TOKEN_INVALID'),
  @JsonValue('PROVIDER_UNAVAILABLE')
  providerUnavailable('PROVIDER_UNAVAILABLE'),
  @JsonValue('FEATURE_DISABLED')
  featureDisabled('FEATURE_DISABLED'),
  @JsonValue('AI_REVIEW_REQUIRED')
  aiReviewRequired('AI_REVIEW_REQUIRED'),
  @JsonValue('AI_DRAFT_CLOSED')
  aiDraftClosed('AI_DRAFT_CLOSED'),
  @JsonValue('AI_CONSENT_REQUIRED')
  aiConsentRequired('AI_CONSENT_REQUIRED'),
  @JsonValue('AI_ACK_VERSION_OUTDATED')
  aiAckVersionOutdated('AI_ACK_VERSION_OUTDATED'),
  @JsonValue('AI_CREDENTIAL_DUPLICATE')
  aiCredentialDuplicate('AI_CREDENTIAL_DUPLICATE'),
  @JsonValue('AI_CREDENTIAL_REVOKED')
  aiCredentialRevoked('AI_CREDENTIAL_REVOKED'),
  @JsonValue('INVALID_CREDENTIAL')
  invalidCredential('INVALID_CREDENTIAL'),
  @JsonValue('QUOTA_EXHAUSTED')
  quotaExhausted('QUOTA_EXHAUSTED'),
  @JsonValue('MODEL_UNAVAILABLE')
  modelUnavailable('MODEL_UNAVAILABLE'),
  @JsonValue('CONTENT_BLOCKED')
  contentBlocked('CONTENT_BLOCKED'),
  @JsonValue('SCHEMA_INVALID')
  schemaInvalid('SCHEMA_INVALID'),
  @JsonValue('TIMEOUT')
  timeout('TIMEOUT'),
  @JsonValue('PROVIDER_ERROR')
  providerError('PROVIDER_ERROR'),
  @JsonValue('PHI_MINIMIZATION_FAILED')
  phiMinimizationFailed('PHI_MINIMIZATION_FAILED'),
  @JsonValue('POLICY_BLOCKED')
  policyBlocked('POLICY_BLOCKED'),
  @JsonValue('PAYMENT_NOT_REQUIRED')
  paymentNotRequired('PAYMENT_NOT_REQUIRED'),
  @JsonValue('FEE_NOT_CONFIGURED')
  feeNotConfigured('FEE_NOT_CONFIGURED'),
  @JsonValue('PAYMENT_METHOD_UNAVAILABLE')
  paymentMethodUnavailable('PAYMENT_METHOD_UNAVAILABLE'),
  @JsonValue('PAYMENT_ALREADY_PAID')
  paymentAlreadyPaid('PAYMENT_ALREADY_PAID'),
  @JsonValue('PAYMENT_INTENT_EXPIRED')
  paymentIntentExpired('PAYMENT_INTENT_EXPIRED'),
  @JsonValue('PAYMENT_GATEWAY_REJECTED')
  paymentGatewayRejected('PAYMENT_GATEWAY_REJECTED'),
  @JsonValue('PAYMENT_GATEWAY_UNAVAILABLE')
  paymentGatewayUnavailable('PAYMENT_GATEWAY_UNAVAILABLE'),
  @JsonValue('MERCHANT_CREDENTIAL_INVALID')
  merchantCredentialInvalid('MERCHANT_CREDENTIAL_INVALID'),
  @JsonValue('REFUND_NOT_ALLOWED')
  refundNotAllowed('REFUND_NOT_ALLOWED'),
  @JsonValue('SMS_CREDENTIAL_INVALID')
  smsCredentialInvalid('SMS_CREDENTIAL_INVALID'),
  @JsonValue('MEDDATA_CHECKSUM_MISMATCH')
  meddataChecksumMismatch('MEDDATA_CHECKSUM_MISMATCH'),
  @JsonValue('MEDDATA_SCHEMA_UNSUPPORTED')
  meddataSchemaUnsupported('MEDDATA_SCHEMA_UNSUPPORTED'),
  @JsonValue('MEDDATA_IMPORT_IN_PROGRESS')
  meddataImportInProgress('MEDDATA_IMPORT_IN_PROGRESS'),
  @JsonValue('MEDDATA_GATE_ALREADY_ATTESTED')
  meddataGateAlreadyAttested('MEDDATA_GATE_ALREADY_ATTESTED'),
  @JsonValue('PLATFORM_CONTEXT_REQUIRED')
  platformContextRequired('PLATFORM_CONTEXT_REQUIRED'),
  @JsonValue('DATA_INTEGRITY_ERROR')
  dataIntegrityError('DATA_INTEGRITY_ERROR'),
  @JsonValue('INTERNAL_ERROR')
  internalError('INTERNAL_ERROR'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const ErrorCode(this.json);

  factory ErrorCode.fromJson(String json) => values.firstWhere(
        (e) => e.json == json,
        orElse: () => $unknown,
      );

  final String? json;
  String toJson() {
    final value = json;
    if (value == null) {
      throw StateError('Cannot convert enum value with null JSON representation to String. '
          'This usually happens for \$unknown or @JsonValue(null) entries.');
    }
    return value as String;
  }

  @override
  String toString() => json?.toString() ?? super.toString();
  /// Returns all defined enum values excluding the $unknown value.
  static List<ErrorCode> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
