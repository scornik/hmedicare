import { api, getTenant, patientApi } from '../api';
import { apiBase, getAccessToken, refresh } from '../auth/session';

/** Download with the in-memory access token. A browser navigation cannot attach that header. */
export async function downloadDocument(
  documentId: string,
  patientContext?: { tenantId: string; patientId: string },
): Promise<void> {
  const tenantId = patientContext?.tenantId ?? getTenant() ?? '';
  const headers = {
    'X-Tenant-ID': tenantId,
    'Idempotency-Key': crypto.randomUUID(),
    ...(patientContext ? { 'X-Patient-Context': patientContext.patientId } : {}),
  };
  const issued = await (patientContext ? patientApi : api).POST('/api/v1/documents/{id}/download-token', {
    params: {
      header: headers,
      path: { id: documentId },
    },
  });
  const token = issued.data?.data.token;
  if (issued.error || !token) throw new Error('Document token unavailable');
  const path = `/api/v1/documents/${encodeURIComponent(documentId)}/download?token=${encodeURIComponent(token)}`;
  const fetchFile = () =>
    fetch(`${apiBase()}${path}`, {
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${getAccessToken() ?? ''}`,
        'X-Tenant-ID': tenantId,
        ...(patientContext ? { 'X-Patient-Context': patientContext.patientId } : {}),
      },
    });
  let response = await fetchFile();
  if (response.status === 401 && (await refresh())) response = await fetchFile();
  if (!response.ok) throw new Error('Document download unavailable');

  const disposition = response.headers.get('content-disposition') ?? '';
  const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  let fileName = 'document';
  if (encodedName) {
    try {
      fileName = decodeURIComponent(encodedName);
    } catch {
      // The server normally supplies a safe name. Keep a generic name if a proxy mangles its header.
    }
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
