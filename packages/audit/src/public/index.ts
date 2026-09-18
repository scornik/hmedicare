// Public surface of the audit context (REPOSITORY-STRUCTURE.md §2.2).
export * from '../domain/audit-entry';
export { GENESIS_HASH, canonicalJson, computeRowHash } from '../domain/chain-hash';
export type * from '../application/ports';
export { ChainAppender, type ChainSlot } from '../infrastructure/chain-appender';
export {
  AuditMetadataError,
  PrismaAuditPort,
  PrismaAuditReader,
  sanitizeAuditMetadata,
} from '../infrastructure/prisma-audit';
export {
  type ChainRow,
  type ChainSource,
  VERIFY_CHAINS_JOB,
  VerifyAppendOnlyChains,
  type VerifyOptions,
  auditChainSource,
  registerChainVerification,
} from '../infrastructure/verify-chains';
