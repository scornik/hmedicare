import type { Readable } from 'node:stream';
import { AppError } from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import type { ObjectStoragePort } from '../application/object-storage-port';
import { ObjectStorageError } from '../application/object-storage-port';
import type { DownloadTokenService } from './download-tokens';

/**
 * Reading a stored document (FILE-STORAGE-IMPLEMENTATION.md §2.5).
 *
 * Deliberately knows nothing about who may read what. Authorization is a clinical question — is this
 * actor assigned to the encounter, or scoped to its chamber — and answering it here would mean this
 * context importing the clinical one and the two drifting apart. The caller authorizes, then calls in.
 *
 * What this does own is the pair of invariants that are about the file itself: a download serves the
 * revision the token names, and a document that is not `AVAILABLE` serves nothing at all.
 */
export interface DocumentDescriptor {
  documentId: string;
  patientId: string;
  encounterId: string | null;
  category: string;
  revision: number;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  /** For `Content-Disposition`; never a name a client supplied. */
  fileName: string;
}

export interface DocumentDownloadDeps {
  prisma: PrismaClient;
  storage: ObjectStoragePort;
  tokens: DownloadTokenService;
}

export class DocumentDownloadService {
  constructor(private readonly deps: DocumentDownloadDeps) {}

  /** The document and the revision a download would serve, or null when there is no such document. */
  async describe(tenantId: string, documentId: string): Promise<DocumentDescriptor | null> {
    const doc = await this.deps.prisma.document.findFirst({
      where: { tenantId, id: documentId },
      select: {
        id: true,
        patientId: true,
        encounterId: true,
        category: true,
        status: true,
        currentRevision: true,
        redactedAt: true,
      },
    });
    if (!doc) return null;
    if (doc.redactedAt) throw new AppError('DOCUMENT_NOT_AVAILABLE');
    if (doc.status !== 'AVAILABLE' || doc.currentRevision === null) {
      // A document still uploading, scanning or rejected is not a download that should 404 — the caller
      // may legitimately see that it exists and is not ready.
      throw new AppError('DOCUMENT_NOT_AVAILABLE');
    }
    const version = await this.deps.prisma.documentVersion.findFirst({
      where: { tenantId, documentId, revision: doc.currentRevision },
      select: { revision: true, contentType: true, sizeBytes: true, sha256: true },
    });
    if (!version) throw new AppError('DOCUMENT_NOT_AVAILABLE');
    return {
      documentId: doc.id,
      patientId: doc.patientId,
      encounterId: doc.encounterId,
      category: doc.category,
      revision: version.revision,
      contentType: version.contentType,
      sizeBytes: Number(version.sizeBytes),
      sha256: version.sha256,
      fileName: safeFileName(doc.category, doc.id, version.revision, version.contentType),
    };
  }

  /** Issues a download token for the current revision. The caller has already authorized the read. */
  async issueToken(
    tenantId: string,
    actorUserId: string,
    documentId: string,
  ): Promise<{ token: string; expiresAt: Date; revision: number }> {
    const doc = await this.describe(tenantId, documentId);
    if (!doc) throw new AppError('RESOURCE_NOT_FOUND');
    const { token, expiresAt } = this.deps.tokens.issue({
      tenantId,
      actorUserId,
      documentId,
      revision: doc.revision,
    });
    return { token, expiresAt, revision: doc.revision };
  }

  /**
   * Spends the token and opens the bytes.
   *
   * The token is redeemed against the revision it was issued for, not against whatever is current now:
   * a re-render between issuing and following the link must serve the revision the caller was
   * authorized for rather than quietly handing them a different document.
   */
  async open(input: {
    tenantId: string;
    actorUserId: string;
    documentId: string;
    token: string;
  }): Promise<{ stream: Readable; document: DocumentDescriptor }> {
    const doc = await this.describe(input.tenantId, input.documentId);
    if (!doc) throw new AppError('RESOURCE_NOT_FOUND');
    await this.deps.tokens.redeem(input.token, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      documentId: input.documentId,
      revision: doc.revision,
    });

    const version = await this.deps.prisma.documentVersion.findFirstOrThrow({
      where: { tenantId: input.tenantId, documentId: input.documentId, revision: doc.revision },
      select: { storageKey: true },
    });
    try {
      const { stream } = await this.deps.storage.get(version.storageKey);
      return { stream, document: doc };
    } catch (e) {
      if (e instanceof ObjectStorageError && e.code === 'OBJECT_NOT_FOUND') {
        // The row promised bytes that are not there. Reported as unavailable rather than as a missing
        // document, because the record does exist and an operator needs to know the two disagree.
        throw new AppError('DOCUMENT_NOT_AVAILABLE');
      }
      throw e;
    }
  }
}

/**
 * A filename built from ids, never from anything a client supplied.
 *
 * An uploaded name would be the one place a download could carry an attacker's text into a header. The
 * category and revision are enough for a human to tell two downloads apart, which is all the name is
 * for.
 */
export function safeFileName(
  category: string,
  documentId: string,
  revision: number,
  contentType: string,
): string {
  const extension = contentType === 'application/pdf' ? 'pdf' : 'bin';
  const slug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${slug}-${documentId}-r${revision}.${extension}`;
}
