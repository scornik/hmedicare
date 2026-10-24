import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getTenant } from '../api';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { downloadDocument } from './download';
import { uploadEncounterDocument, type UploadCategory } from './upload';

const categoryKeys: Record<string, MessageKey> = {
  PRESCRIPTION_PDF: 'documents.category.prescription',
  LAB_REPORT: 'documents.category.lab',
  IMAGE: 'documents.category.image',
  REFERRAL: 'documents.category.referral',
  OTHER: 'documents.category.other',
};

export function EncounterDocumentsPanel({
  encounterId,
  patientId,
}: {
  encounterId: string;
  patientId: string;
}) {
  const { t, locale } = useI18n();
  const tenant = getTenant();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<UploadCategory>('LAB_REPORT');
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [pendingDocumentId, setPendingDocumentId] = useState<string | null>(null);
  const allowedTypes =
    category === 'IMAGE'
      ? ['image/jpeg', 'image/png', 'image/webp']
      : category === 'LAB_REPORT'
        ? ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
        : ['application/pdf', 'image/jpeg', 'image/png'];
  const fileValid =
    !!file &&
    file.size > 0 &&
    file.size <= (category === 'IMAGE' ? 10 : 20) * 1024 * 1024 &&
    allowedTypes.includes(file.type);
  const capability = useQuery({
    queryKey: ['document-upload-capability', tenant],
    queryFn: async () => {
      const result = await api.GET('/api/v1/documents/upload-capability', {
        params: { header: { 'X-Tenant-ID': tenant ?? '' } },
      });
      if (result.error || !result.data) return false;
      return result.data.data.enabled;
    },
  });
  const list = useQuery({
    queryKey: ['encounter-documents', tenant, encounterId, page],
    queryFn: async () => {
      const result = await api.GET('/api/v1/documents/by-encounter/{encounterId}', {
        params: {
          header: { 'X-Tenant-ID': tenant ?? '' },
          path: { encounterId },
          query: { page },
        },
      });
      if (result.error || !result.data) throw new Error('Document list unavailable');
      return result.data.data;
    },
  });
  const download = useMutation({
    mutationFn: (documentId: string) => downloadDocument(documentId),
  });
  const processing = useQuery({
    queryKey: ['document-processing', tenant, pendingDocumentId],
    enabled: pendingDocumentId !== null,
    queryFn: async () => {
      const result = await api.GET('/api/v1/documents/{id}', {
        params: { header: { 'X-Tenant-ID': tenant ?? '' }, path: { id: pendingDocumentId! } },
      });
      if (result.error || !result.data) throw new Error('Document status unavailable');
      return result.data.data;
    },
    refetchInterval: (query) =>
      ['AVAILABLE', 'REJECTED', 'EXPIRED'].includes(query.state.data?.status ?? '') ? false : 5000,
  });
  useEffect(() => {
    if (processing.data?.status === 'AVAILABLE')
      void queryClient.invalidateQueries({ queryKey: ['encounter-documents', tenant, encounterId] });
  }, [processing.data?.status, queryClient, tenant, encounterId]);
  const upload = useMutation({
    mutationFn: () =>
      uploadEncounterDocument({
        encounterId,
        patientId,
        category,
        file: file!,
        onProgress: (completed, total) => setProgress({ completed, total }),
      }),
    onMutate: () => setPendingDocumentId(null),
    onSuccess: (documentId) => {
      setPendingDocumentId(documentId);
      setFile(null);
      setInputKey((value) => value + 1);
      setProgress(null);
      void list.refetch();
    },
  });

  return (
    <section
      className="card encounter-documents"
      aria-labelledby="encounter-documents-heading"
      data-testid="panel-documents"
    >
      <div className="row">
        <h2 id="encounter-documents-heading">{t('documents.title')}</h2>
        <button type="button" onClick={() => void list.refetch()} disabled={list.isFetching}>
          {t('documents.refresh')}
        </button>
      </div>
      {capability.data === false && <p className="muted">{t('documents.uploadUnavailable')}</p>}
      {capability.data === true && (
        <form
          className="encounter-document-upload"
          onSubmit={(event) => {
            event.preventDefault();
            if (fileValid && !upload.isPending) upload.mutate();
          }}
        >
          <label>
            {t('documents.uploadCategory')}
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as UploadCategory);
                upload.reset();
              }}
              disabled={upload.isPending}
            >
              {(['LAB_REPORT', 'IMAGE', 'REFERRAL', 'OTHER'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(categoryKeys[value] ?? 'documents.category.other')}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('documents.chooseFile')}
            <input
              key={inputKey}
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp"
              disabled={upload.isPending}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                upload.reset();
              }}
            />
          </label>
          <button type="submit" disabled={!fileValid || upload.isPending}>
            {t('documents.upload')}
          </button>
        </form>
      )}
      {file && !fileValid && <p role="alert">{t('documents.invalidFile')}</p>}
      {upload.isPending && (
        <p role="status">
          {t('documents.uploading')}
          {progress ? ` ${progress.completed}/${progress.total}` : ''}
        </p>
      )}
      {upload.isSuccess && !['AVAILABLE', 'REJECTED', 'EXPIRED'].includes(processing.data?.status ?? '') && (
        <p role="status">{t('documents.scanning')}</p>
      )}
      {processing.data?.status === 'AVAILABLE' && <p role="status">{t('documents.ready')}</p>}
      {['REJECTED', 'EXPIRED'].includes(processing.data?.status ?? '') && (
        <p role="alert">{t('documents.rejected')}</p>
      )}
      {processing.isError && (
        <p role="alert">
          {t('documents.statusFailed')}{' '}
          <button type="button" onClick={() => void processing.refetch()}>
            {t('documents.retry')}
          </button>
        </p>
      )}
      {upload.isError && <p role="alert">{t('documents.uploadFailed')}</p>}
      {list.isPending && <p role="status">{t('common.loading')}</p>}
      {list.isError && (
        <p role="alert">
          {t('documents.listFailed')}{' '}
          <button type="button" onClick={() => void list.refetch()}>
            {t('documents.retry')}
          </button>
        </p>
      )}
      {list.data && list.data.items.length === 0 && <p className="muted">{t('documents.empty')}</p>}
      {list.data && list.data.items.length > 0 && (
        <ul className="encounter-document-list" data-testid="encounter-documents">
          {list.data.items.map((document) => (
            <li key={document.id}>
              <div>
                <strong>
                  {document.title || t(categoryKeys[document.category] ?? 'documents.category.other')}
                </strong>
                <span className="muted">
                  {t(categoryKeys[document.category] ?? 'documents.category.other')} ·{' '}
                  <time dateTime={document.createdAt}>
                    {new Date(document.createdAt).toLocaleDateString(locale)}
                  </time>
                </span>
              </div>
              <button
                type="button"
                disabled={download.isPending}
                onClick={() => download.mutate(document.id)}
                aria-label={`${t('documents.download')}: ${document.title || t(categoryKeys[document.category] ?? 'documents.category.other')}`}
              >
                {t('documents.download')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {download.isError && <p role="alert">{t('documents.downloadFailed')}</p>}
      {list.data && (page > 1 || list.data.hasMore) && (
        <div className="row encounter-documents-pages">
          <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
            {t('documents.previous')}
          </button>
          <span>{t('documents.page').replace('{n}', String(page))}</span>
          <button type="button" disabled={!list.data.hasMore} onClick={() => setPage((value) => value + 1)}>
            {t('documents.next')}
          </button>
        </div>
      )}
    </section>
  );
}
