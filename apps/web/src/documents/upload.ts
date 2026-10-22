import { api, getTenant } from '../api';
import { apiBase, getAccessToken, refresh } from '../auth/session';

export type UploadCategory = 'LAB_REPORT' | 'IMAGE' | 'REFERRAL' | 'OTHER';
const partSize = 5 * 1024 * 1024;

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sendPart(sessionId: string, partNumber: number, bytes: ArrayBuffer, checksum: string) {
  const url = `${apiBase()}/api/v1/documents/upload-sessions/${encodeURIComponent(sessionId)}/parts/${partNumber}`;
  const send = () =>
    fetch(url, {
      method: 'PUT',
      body: bytes,
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${getAccessToken() ?? ''}`,
        'X-Tenant-ID': getTenant() ?? '',
        'X-Part-SHA256': checksum,
        'Content-Type': 'application/octet-stream',
      },
    });
  let result = await send();
  if (result.status === 401 && (await refresh())) result = await send();
  if (!result.ok) throw new Error('Upload part failed');
}

export async function uploadEncounterDocument(input: {
  encounterId: string;
  patientId: string;
  category: UploadCategory;
  file: File;
  onProgress: (completed: number, total: number) => void;
}): Promise<void> {
  const { file, encounterId, patientId, category, onProgress } = input;
  const bytes = await file.arrayBuffer();
  const digest = await sha256(bytes);
  const created = await api.POST('/api/v1/documents/upload-sessions', {
    params: { header: { 'X-Tenant-ID': getTenant() ?? '', 'Idempotency-Key': crypto.randomUUID() } },
    body: {
      patientId,
      encounterId,
      category,
      contentType: file.type,
      sizeBytes: file.size,
      sha256: digest,
      fileName: file.name,
    },
  });
  if (created.error || !created.data) throw new Error('Upload session unavailable');
  const { sessionId, partCount } = created.data.data;
  try {
    for (let index = 0; index < partCount; index++) {
      const part = bytes.slice(index * partSize, Math.min(bytes.byteLength, (index + 1) * partSize));
      await sendPart(sessionId, index + 1, part, await sha256(part));
      onProgress(index + 1, partCount);
    }
    const finalized = await api.POST('/api/v1/documents/upload-sessions/{sessionId}/finalize', {
      params: {
        header: { 'X-Tenant-ID': getTenant() ?? '', 'Idempotency-Key': crypto.randomUUID() },
        path: { sessionId },
      },
    });
    if (finalized.error || !finalized.data) throw new Error('Upload finalization failed');
  } catch (error) {
    await api
      .POST('/api/v1/documents/upload-sessions/{sessionId}/abort', {
        params: {
          header: { 'X-Tenant-ID': getTenant() ?? '', 'Idempotency-Key': crypto.randomUUID() },
          path: { sessionId },
        },
      })
      .catch(() => undefined);
    throw error;
  }
}
