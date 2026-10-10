// Public surface of the communication context (REPOSITORY-STRUCTURE.md §2.2).
export * from '../domain/sms-encoding';
export * from '../domain/sms-templates';
export type * from '../application/sms-ports';
export * from '../infrastructure/sms-otp-delivery';
export * from '../infrastructure/sms-balance';
export type * from '../application/ports/communication-provider';
export type * from '../application/ports/communication-source';
export { CommunicationService } from '../infrastructure/communication-service';
export { CommunicationHistoryMetadata } from '../infrastructure/history-metadata';
export { transactionalSmsDecision } from '../infrastructure/transactional-sms-policy';
export {
  TransactionalSmsDelivery,
  DELIVER_TRANSACTIONAL_SMS,
} from '../infrastructure/transactional-sms-delivery';
export { SmsAccountService } from '../infrastructure/sms-account-service';
